import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cleanInstallScenario,
  durableAgentTerminalFlowScenario,
  failedUpdateRecoveryScenario,
  findAppExecutable,
  missingDependencyDiagnosticScenario,
  osPermissionDiagnosticScenario,
  pendingRuntimeEvidence,
  requireSandboxPath,
  runAcceptance,
  rustOnlyProcessShapeScenario,
  uninstallPreservesDataScenario,
  upgradeWithExistingDataScenario,
} from "./installed-artifact-acceptance-driver.mjs";
import { assertAcceptanceResult } from "./installed-artifact-acceptance.mjs";

const CREDENTIAL_PATTERN =
  /((api|access|auth|secret|token|password)[_-]?(key|token|password)?\s*[=:])|bearer\s+/i;
async function fixture() {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), "ticketry-driver-test-"));
  const dataDirectory = path.join(sandboxRoot, "home", ".config", "worktracker-studio");
  const appPath = path.join(sandboxRoot, "Applications", "Ticketry.app");
  const databasePath = path.join(dataDirectory, "state.db");
  await mkdir(dataDirectory, { recursive: true });
  await mkdir(path.join(appPath, "Contents", "MacOS"), { recursive: true });
  await mkdir(path.join(appPath, "Contents", "Resources"), { recursive: true });
  await Promise.all([
    writeFile(path.join(appPath, "Contents", "MacOS", "ticketry"), "app", { mode: 0o700 }),
    writeFile(path.join(appPath, "Contents", "MacOS", "ticketry-hook"), "hook", { mode: 0o700 }),
  ]);
  await writeFile(databasePath, "database-fixture");

  let upgradeSentinel = "";
  let durableStored = "";
  const context = {
    appPath,
    dataDirectory,
    databasePath,
    diagnostics: [],
    environment: {
      HOME: path.join(sandboxRoot, "home"),
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      TMPDIR: path.join(sandboxRoot, "home", "tmp"),
    },
    executable: path.join(appPath, "Contents", "MacOS", "ticketry"),
    findTmux: async () => "/opt/homebrew/bin/tmux",
    run: async (command, args) => {
      if (command === "/usr/bin/env" && args.includes("/usr/bin/which")) {
        return { code: 1, stdout: "", stderr: "" };
      }
      if (command === "/bin/sh") {
        return { code: 1, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    sandboxRoot,
    sqliteStatements: [],
    sqlite: async (_database, sql) => {
      context.sqliteStatements.push(sql);
      if (sql.includes("SELECT count(*) FROM worktracker_workspace")) return "1";
      if (sql.includes("INSERT OR REPLACE INTO acceptance_evidence")) {
        upgradeSentinel = sql.match(/VALUES \('upgrade', '([^']+)'\)/)?.[1] ?? "";
        return "";
      }
      if (sql.includes("SELECT value FROM acceptance_evidence")) return upgradeSentinel;
      if (sql.includes("SELECT id FROM worktracker_project")) return "project-1";
      if (sql.includes("SELECT id,type FROM worktracker_issue")) {
        return "module-1|module\ntask-1|task";
      }
      if (sql.includes("INSERT INTO agent_terminal_sessions")) {
        const session = sql.match(/'pt-acceptance-run-[^']+'/)?.[0]?.slice(1, -1);
        durableStored = `${path.join(sandboxRoot, "repository")}|${session}`;
        return "";
      }
      if (sql.includes("JOIN agent_terminal_sessions")) return durableStored;
      return "";
    },
    startApp: () => {
      mkdirSync(dataDirectory, { recursive: true });
      if (!existsSync(databasePath)) writeFileSync(databasePath, "database-fixture");
      return Object.assign(new EventEmitter(), {
        exitCode: null,
        signalCode: null,
      });
    },
    stopApp: async () => {},
    timeoutMs: 1_000,
    waitFor: async (check) => {
      const value = await check();
      if (!value) throw new Error("fixture check was not ready");
      return value;
    },
  };
  return { context, sandboxRoot };
}

async function withFixture(run) {
  const { context, sandboxRoot } = await fixture();
  try {
    return await run(context);
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
}

test("clean_install launches a fresh data directory and reaches its workspace", async () => {
  await withFixture(async (context) => {
    assert.equal(await cleanInstallScenario(context), true);
  });
});

test("main executable comes from CFBundleExecutable when helpers are also executable", async () => {
  await withFixture(async (context) => {
    const main = path.join(context.appPath, "Contents", "MacOS", "ticketry");
    await writeFile(main, "main", { mode: 0o700 });
    await writeFile(
      path.join(context.appPath, "Contents", "MacOS", "ticketry-hook"),
      "hook",
      { mode: 0o700 },
    );
    assert.equal(
      await findAppExecutable(context.appPath, async () => ({
        code: 0,
        stdout: "ticketry\n",
        stderr: "",
      })),
      main,
    );
  });
});

test("upgrade_with_existing_data preserves a sentinel and three snapshot generations", async () => {
  await withFixture(async (context) => {
    assert.equal(await upgradeWithExistingDataScenario(context), true);
    assert.equal(
      context.sqliteStatements.includes("PRAGMA wal_checkpoint(TRUNCATE);"),
      true,
    );
    for (const generation of [1, 2, 3]) {
      assert.equal(
        await readFile(
          path.join(context.dataDirectory, `state.db.pre-migration.${generation}`),
          "utf8",
        ),
        "database-fixture",
      );
    }
  });
});

test("failed_update_recovery restores a snapshot and relaunches", async () => {
  await withFixture(async (context) => {
    await writeFile(
      path.join(context.dataDirectory, "state.db.pre-migration.1"),
      "restored-database",
    );
    assert.equal(await failedUpdateRecoveryScenario(context), true);
    assert.equal(await readFile(context.databasePath, "utf8"), "restored-database");
  });
});

test("missing_dependency_diagnostic is actionable and redacted", async () => {
  await withFixture(async (context) => {
    assert.equal(await missingDependencyDiagnosticScenario(context), true);
    assert.deepEqual(context.diagnostics.map(({ kind }) => kind), ["missing_dependency"]);
    assert.equal(CREDENTIAL_PATTERN.test(context.diagnostics[0].message), false);
  });
});

test("os_permission_diagnostic proves denial and remains redacted", async () => {
  await withFixture(async (context) => {
    assert.equal(await osPermissionDiagnosticScenario(context), true);
    assert.deepEqual(context.diagnostics.map(({ kind }) => kind), ["os_permission"]);
    assert.equal(CREDENTIAL_PATTERN.test(context.diagnostics[0].message), false);
  });
});

test("durable_agent_terminal_flow keeps repository, run, and tmux evidence across relaunch", async () => {
  await withFixture(async (context) => {
    assert.equal(await durableAgentTerminalFlowScenario(context), true);
    assert.equal(
      context.sqliteStatements.some(
        (sql) => sql.includes("runtime_cleanup_pending, output_sequence"),
      ),
      true,
    );
  });
});

test("uninstall_preserves_data removes only the installed app", async () => {
  await withFixture(async (context) => {
    assert.equal(await uninstallPreservesDataScenario(context), true);
    await assert.rejects(readFile(context.appPath));
    assert.equal(await readFile(context.databasePath, "utf8"), "database-fixture");
  });
});

test("Rust process-shape evidence starts fail-closed", () => {
  assert.deepEqual(pendingRuntimeEvidence(), {
    rust_only_process_shape: false,
  });
});

test("installed artifact contains no retired runtime executable", async () => {
  await withFixture(async (context) => {
    assert.deepEqual(await rustOnlyProcessShapeScenario(context), {
      rust_only_process_shape: true,
    });
  });
});

test("installed artifact rejects stale helpers and generated REST contracts", async () => {
  await withFixture(async (context) => {
    await writeFile(
      path.join(context.appPath, "Contents", "MacOS", "verify_slice6_copy"),
      "helper",
    );
    await assert.rejects(
      rustOnlyProcessShapeScenario(context),
      /unexpected helpers: verify_slice6_copy/,
    );
    await rm(path.join(context.appPath, "Contents", "MacOS", "verify_slice6_copy"));
    await writeFile(path.join(context.appPath, "Contents", "Resources", "openapi.json"), "{}");
    await assert.rejects(
      rustOnlyProcessShapeScenario(context),
      /retired Python\/REST artifacts: Contents\/Resources\/openapi.json/,
    );
  });
});

test("installed artifact rejects every retired runtime artifact class", async () => {
  await withFixture(async (context) => {
    const resources = path.join(context.appPath, "Contents", "Resources");
    for (const artifact of [
      "python3",
      "libpython3.12.dylib",
      "Django",
      "FastMCP",
      "worktracker-python-sdk",
      "worktracker-typescript-sdk",
      "sidecar-launch-configuration.json",
      "legacy_helper.py",
    ]) {
      const artifactPath = path.join(resources, artifact);
      await writeFile(artifactPath, "retired");
      await assert.rejects(
        rustOnlyProcessShapeScenario(context),
        new RegExp(artifact.replaceAll(".", "\\."), "i"),
      );
      await rm(artifactPath);
    }

    const themes = path.join(resources, "ghostty", "themes");
    await mkdir(themes, { recursive: true });
    await writeFile(path.join(themes, "Django"), "terminal theme");
    assert.deepEqual(await rustOnlyProcessShapeScenario(context), {
      rust_only_process_shape: true,
    });
  });
});

test("sandbox validation accepts a symlinked macOS temporary root", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "ticketry-driver-realpath-"));
  const actualRoot = path.join(temporary, "actual");
  const linkedRoot = path.join(temporary, "linked");
  const home = path.join(actualRoot, "home");
  try {
    await mkdir(home, { recursive: true });
    await symlink(actualRoot, linkedRoot);
    await assert.doesNotReject(
      requireSandboxPath(linkedRoot, path.join(linkedRoot, "home"), "HOME", {
        mustExist: true,
      }),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a complete scenario run emits Rust-only evidence without credentials", async () => {
  await withFixture(async (context) => {
    const result = await runAcceptance(context);
    for (const scenario of [
      "clean_install",
      "upgrade_with_existing_data",
      "failed_update_recovery",
      "uninstall_preserves_data",
      "missing_dependency_diagnostic",
      "os_permission_diagnostic",
      "durable_agent_terminal_flow",
    ]) {
      assert.equal(result[scenario], true, scenario);
    }
    assert.equal(result.rust_only_process_shape, true);
    assert.doesNotThrow(() => assertAcceptanceResult(result));
    assert.equal(
      result.diagnostics.some(({ message }) => CREDENTIAL_PATTERN.test(message)),
      false,
    );
  });
});
