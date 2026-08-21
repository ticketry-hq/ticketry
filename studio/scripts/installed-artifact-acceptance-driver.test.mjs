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
  packagedSkillEvidenceScenario,
  pendingSkillEvidence,
  requireSandboxPath,
  runAcceptance,
  uninstallPreservesDataScenario,
  upgradeWithExistingDataScenario,
} from "./installed-artifact-acceptance-driver.mjs";
import { assertAcceptanceResult } from "./installed-artifact-acceptance.mjs";

const CREDENTIAL_PATTERN =
  /((api|access|auth|secret|token|password)[_-]?(key|token|password)?\s*[=:])|bearer\s+/i;
const PACKAGED_SKILLS = [
  "code-review",
  "domain-modeling",
  "grill-with-docs",
  "grilling",
  "implement",
  "setup-matt-pocock-skills",
  "tdd",
  "to-spec",
  "to-tickets",
];

async function fixture({ issueRows = "module-1|module\ntask-1|task" } = {}) {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), "ticketry-driver-test-"));
  const dataDirectory = path.join(sandboxRoot, "home", ".config", "worktracker-studio");
  const appPath = path.join(sandboxRoot, "Applications", "Ticketry.app");
  const databasePath = path.join(dataDirectory, "state.db");
  const sidecarLog = path.join(dataDirectory, "sidecar.log");
  const sidecarExecutable = path.join(appPath, "Contents", "MacOS", "muxed-backend");
  await mkdir(dataDirectory, { recursive: true });
  await mkdir(path.dirname(sidecarExecutable), { recursive: true });
  await writeFile(sidecarExecutable, "sidecar-fixture");
  await writeFile(databasePath, "database-fixture");
  await writeFile(
    sidecarLog,
    '{"event":"ready","host":"127.0.0.1","port":43123,"credential_required":true}\n',
  );

  let upgradeSentinel = "";
  let durableStored = "";
  const sqlStatements = [];
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
    sidecarExecutable,
    findTmux: async () => "/opt/homebrew/bin/tmux",
    run: async (command, args) => {
      if (command === sidecarExecutable && args.join(" ") === "skills smoke-providers") {
        return {
          code: 0,
          stdout: `${JSON.stringify({
            providers: Object.fromEntries(
              ["claude", "codex", "agy", "gemini"].map((provider) => [
                provider,
                PACKAGED_SKILLS,
              ]),
            ),
            mcp_configured: {
              claude: true,
              codex: true,
              agy: true,
              gemini: true,
            },
          })}\n`,
          stderr: "",
        };
      }
      if (command === "/usr/bin/env" && args.includes("/usr/bin/which")) {
        return { code: 1, stdout: "", stderr: "" };
      }
      if (command === "/bin/sh") {
        return { code: 1, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    sandboxRoot,
    sidecarLog,
    sqlite: async (_database, sql) => {
      sqlStatements.push(sql);
      if (sql.includes("SELECT count(*) FROM worktracker_project")) return "1";
      if (sql.includes("INSERT OR REPLACE INTO acceptance_evidence")) {
        upgradeSentinel = sql.match(/VALUES \('upgrade', '([^']+)'\)/)?.[1] ?? "";
        return "";
      }
      if (sql.includes("SELECT value FROM acceptance_evidence")) return upgradeSentinel;
      if (sql.includes("SELECT id FROM worktracker_project")) return "project-1";
      if (sql.includes("SELECT id,type FROM worktracker_issue")) {
        return issueRows;
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
      writeFileSync(
        sidecarLog,
        '{"event":"ready","host":"127.0.0.1","port":43123,"credential_required":true}\n',
      );
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
  return { context, sandboxRoot, sqlStatements };
}

async function withFixture(run) {
  const { context, sandboxRoot } = await fixture();
  try {
    return await run(context);
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
}

test("clean_install launches a fresh data directory and reaches its project", async () => {
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
  });
});

test("durable_agent_terminal_flow provisions work items for a fresh project", async () => {
  const { context, sandboxRoot, sqlStatements } = await fixture({ issueRows: "" });
  try {
    assert.equal(await durableAgentTerminalFlowScenario(context), true);
    assert.equal(
      sqlStatements.filter((sql) => sql.includes("INSERT INTO worktracker_issue")).length,
      2,
    );
    assert.equal(
      sqlStatements.some((sql) => sql.includes(
        "runtime_cleanup_pending, output_sequence",
      )),
      true,
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("uninstall_preserves_data removes only the installed app", async () => {
  await withFixture(async (context) => {
    assert.equal(await uninstallPreservesDataScenario(context), true);
    await assert.rejects(readFile(context.appPath));
    assert.equal(await readFile(context.databasePath, "utf8"), "database-fixture");
  });
});

test("skill evidence starts fail-closed before the packaged smoke runs", () => {
  assert.deepEqual(pendingSkillEvidence(), {
    offline_packaged_skill_matrix: false,
    skill_configuration_unchanged: false,
    skill_overlay_cleanup: false,
    packaged_skill_providers: {},
  });
});

test("packaged sidecar smoke proves provider discovery, config preservation, and cleanup", async () => {
  await withFixture(async (context) => {
    assert.deepEqual(await packagedSkillEvidenceScenario(context), {
      offline_packaged_skill_matrix: true,
      skill_configuration_unchanged: true,
      skill_overlay_cleanup: true,
      packaged_skill_providers: {
        claude: PACKAGED_SKILLS,
        codex: PACKAGED_SKILLS,
        agy: PACKAGED_SKILLS,
        gemini: PACKAGED_SKILLS,
      },
    });
  });
});

test("packaged sidecar smoke rejects a missing transitive skill", async () => {
  await withFixture(async (context) => {
    const run = context.run;
    context.run = async (command, args) => {
      const result = await run(command, args);
      if (command !== context.sidecarExecutable
        || args.join(" ") !== "skills smoke-providers") {
        return result;
      }
      const evidence = JSON.parse(result.stdout);
      evidence.providers.codex = evidence.providers.codex.filter(
        (skill) => skill !== "domain-modeling",
      );
      return { ...result, stdout: `${JSON.stringify(evidence)}\n` };
    };

    await assert.rejects(
      packagedSkillEvidenceScenario(context),
      /did not expose required skills and MCP for codex/,
    );
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

test("a complete scenario run emits full packaged-skill evidence without credentials", async () => {
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
    assert.equal(result.offline_packaged_skill_matrix, true);
    assert.equal(result.skill_configuration_unchanged, true);
    assert.equal(result.skill_overlay_cleanup, true);
    assert.doesNotThrow(() => assertAcceptanceResult(result));
    assert.equal(
      result.diagnostics.some(({ message }) => CREDENTIAL_PATTERN.test(message)),
      false,
    );
  });
});
