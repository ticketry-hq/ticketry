import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectReleaseBundle } from "./release-bundle-inspection.mjs";

const DEFAULT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 100;
const REQUIRED_DIAGNOSTIC_KINDS = ["missing_dependency", "os_permission"];
const CREDENTIAL_PATTERN =
  /((api|access|auth|secret|token|password)[_-]?(key|token|password)?\s*[=:])|bearer\s+/i;

export class InstalledArtifactDriverError extends Error {}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function requireSandboxPath(
  root,
  candidate,
  label,
  { mustExist = false } = {},
) {
  if (!path.isAbsolute(candidate) || !isInside(root, path.resolve(candidate))) {
    throw new InstalledArtifactDriverError(`${label} must stay inside the acceptance sandbox`);
  }
  if (mustExist) {
    const resolvedRoot = await realpath(root);
    const resolved = await realpath(candidate);
    if (!isInside(resolvedRoot, resolved)) {
      throw new InstalledArtifactDriverError(`${label} resolves outside the acceptance sandbox`);
    }
  }
}

function runCommand(command, args, {
  cwd,
  env,
  input,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  allowFailure = false,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        reject,
        new InstalledArtifactDriverError(
          `${path.basename(command)} timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => finish(reject, error));
    child.once("exit", (code, signal) => {
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0 || allowFailure) {
        finish(resolve, result);
      } else {
        finish(
          reject,
          new InstalledArtifactDriverError(
            `${path.basename(command)} failed (${code ?? signal})`,
          ),
        );
      }
    });
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

async function waitFor(check, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new InstalledArtifactDriverError(
    `${label} timed out${lastError ? `: ${lastError.message}` : ""}`,
  );
}

async function sqlite(databasePath, sql, run = runCommand) {
  const result = await run("/usr/bin/sqlite3", ["-batch", "-noheader", databasePath, sql], {
    cwd: path.dirname(databasePath),
  });
  return result.stdout.trim();
}

export async function findAppExecutable(appPath, run = runCommand) {
  const executableDirectory = path.join(appPath, "Contents", "MacOS");
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const result = await run(
    "/usr/bin/plutil",
    ["-extract", "CFBundleExecutable", "raw", "-o", "-", plistPath],
    { cwd: appPath },
  );
  const executableName = result.stdout.trim();
  if (!executableName || path.basename(executableName) !== executableName) {
    throw new InstalledArtifactDriverError(
      "installed app has an invalid CFBundleExecutable",
    );
  }
  const executable = path.join(executableDirectory, executableName);
  const metadata = await stat(executable);
  if (!metadata.isFile() || (metadata.mode & 0o111) === 0) {
    throw new InstalledArtifactDriverError(
      `installed app main executable is missing or not executable: ${executableName}`,
    );
  }
  return executable;
}

function startApp(executable, environment, cwd) {
  const child = spawn(executable, [], {
    cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Drain output without retaining it; acceptance diagnostics never echo
  // process output because it can contain installation-local values.
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

async function stopApp(child, timeoutMs = 10_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      callback(value);
    };
    const termTimer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const killTimer = setTimeout(
      () => finish(reject, new InstalledArtifactDriverError("installed app did not stop")),
      timeoutMs + 5_000,
    );
    child.once("exit", () => finish(resolve));
    child.once("error", (error) => finish(reject, error));
    child.kill("SIGTERM");
  });
}

async function launchReadyApp(context) {
  const child = context.startApp(
    context.executable,
    context.environment,
    context.sandboxRoot,
  );
  try {
    await context.waitFor(
      async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new InstalledArtifactDriverError("installed app exited before readiness");
        }
        const count = await context.sqlite(
          context.databasePath,
          "SELECT count(*) FROM worktracker_workspace;",
        );
        return Number(count) > 0;
      },
      "workspace provisioning",
      context.timeoutMs,
    );
    return { child };
  } catch (error) {
    await context.stopApp(child);
    throw error;
  }
}

async function assertSnapshotSet(dataDirectory) {
  for (const generation of [1, 2, 3]) {
    await access(path.join(dataDirectory, `state.db.pre-migration.${generation}`));
  }
  try {
    await access(path.join(dataDirectory, "state.db.pre-migration.4"));
  } catch {
    return true;
  }
  throw new InstalledArtifactDriverError("snapshot retention exceeded three generations");
}

export async function cleanInstallScenario(context) {
  await rm(context.dataDirectory, { recursive: true, force: true });
  await mkdir(context.dataDirectory, { recursive: true });
  const launched = await launchReadyApp(context);
  await context.stopApp(launched.child);
  return true;
}

export async function upgradeWithExistingDataScenario(context) {
  const sentinel = `acceptance-${Date.now()}`;
  await context.sqlite(
    context.databasePath,
    "CREATE TABLE IF NOT EXISTS acceptance_evidence "
      + "(name TEXT PRIMARY KEY, value TEXT NOT NULL);"
      + `INSERT OR REPLACE INTO acceptance_evidence VALUES ('upgrade', '${sentinel}');`,
  );
  // The desktop database uses WAL mode. Flush committed pages before copying
  // the main file so every recovery generation is a complete SQLite image.
  await context.sqlite(context.databasePath, "PRAGMA wal_checkpoint(TRUNCATE);");
  for (const generation of [1, 2, 3]) {
    await copyFile(
      context.databasePath,
      path.join(context.dataDirectory, `state.db.pre-migration.${generation}`),
    );
  }
  const launched = await launchReadyApp(context);
  await context.stopApp(launched.child);
  const stored = await context.sqlite(
    context.databasePath,
    "SELECT value FROM acceptance_evidence WHERE name = 'upgrade';",
  );
  if (stored !== sentinel) {
    throw new InstalledArtifactDriverError("existing state did not survive upgrade launch");
  }
  await assertSnapshotSet(context.dataDirectory);
  return true;
}

export async function failedUpdateRecoveryScenario(context) {
  const restoreSource = path.join(context.dataDirectory, "state.db.pre-migration.1");
  const restoreTemporary = path.join(context.dataDirectory, "state.db.restore");
  await copyFile(restoreSource, restoreTemporary);
  await chmod(restoreTemporary, 0o600);
  await rename(restoreTemporary, context.databasePath);
  await Promise.all([
    rm(`${context.databasePath}-wal`, { force: true }),
    rm(`${context.databasePath}-shm`, { force: true }),
  ]);
  const launched = await launchReadyApp(context);
  await context.stopApp(launched.child);
  const workspaceCount = Number(await context.sqlite(
    context.databasePath,
    "SELECT count(*) FROM worktracker_workspace;",
  ));
  if (workspaceCount < 1) {
    throw new InstalledArtifactDriverError("restored database has no accessible workspace");
  }
  return true;
}

export async function missingDependencyDiagnosticScenario(context) {
  const result = await context.run(
    "/usr/bin/env",
    ["-i", `PATH=${context.environment.PATH}`, "/usr/bin/which", "tmux"],
    {
      cwd: context.sandboxRoot,
      env: context.environment,
      allowFailure: true,
    },
  );
  if (result.code === 0) {
    throw new InstalledArtifactDriverError("restricted PATH unexpectedly contains tmux");
  }
  context.diagnostics.push({
    kind: "missing_dependency",
    message: "tmux is required. Install it with Homebrew or approve a compatible absolute path.",
  });
  return true;
}

export async function osPermissionDiagnosticScenario(context) {
  const deniedDirectory = path.join(context.sandboxRoot, "permission-denied-repository");
  await mkdir(deniedDirectory, { recursive: true });
  await chmod(deniedDirectory, 0o000);
  try {
    const result = await context.run(
      "/bin/sh",
      ["-c", "test -r \"$1\" && test -w \"$1\"", "permission-check", deniedDirectory],
      {
        cwd: context.sandboxRoot,
        env: context.environment,
        allowFailure: true,
      },
    );
    if (result.code === 0) {
      throw new InstalledArtifactDriverError("permission denial fixture remained accessible");
    }
  } finally {
    await chmod(deniedDirectory, 0o700);
    await rm(deniedDirectory, { recursive: true, force: true });
  }
  context.diagnostics.push({
    kind: "os_permission",
    message: "Grant Ticketry Files and Folders access to the selected repository in macOS Settings.",
  });
  return true;
}

async function findTmux() {
  for (const candidate of [
    "/opt/homebrew/bin/tmux",
    "/usr/local/bin/tmux",
    "/usr/bin/tmux",
  ]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the fixed system installation locations.
    }
  }
  throw new InstalledArtifactDriverError("tmux prerequisite is unavailable");
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function durableFlowTargets(context, identifier, createdAt) {
  const existingProjectId = await context.sqlite(
    context.databasePath,
    "SELECT id FROM worktracker_project ORDER BY created_at LIMIT 1;",
  );
  if (existingProjectId) {
    const rows = (await context.sqlite(
      context.databasePath,
      `SELECT id,type FROM worktracker_issue WHERE project_id=${sqlLiteral(existingProjectId)} `
        + "ORDER BY sequence_id;",
    )).split(/\r?\n/).filter(Boolean).map((row) => row.split("|"));
    const moduleId = rows.find(([, type]) => type === "module")?.[0];
    const taskId = rows.find(([, type]) => type === "task")?.[0];
    if (moduleId && taskId) return { projectId: existingProjectId, moduleId, taskId };
  }

  const workspaceId = await context.sqlite(
    context.databasePath,
    "SELECT id FROM worktracker_workspace ORDER BY created_at LIMIT 1;",
  );
  if (!workspaceId) {
    throw new InstalledArtifactDriverError(
      "durable terminal fixture requires a provisioned workspace",
    );
  }
  const id = () => randomUUID().replaceAll("-", "");
  const projectId = id();
  const moduleTypeId = id();
  const taskTypeId = id();
  const moduleId = id();
  const taskId = id();
  const slug = `acceptance-${identifier}`.slice(0, 64);
  await context.sqlite(
    context.databasePath,
    "INSERT INTO worktracker_project "
      + "(id,name,slug,description,seq_counter,created_at,updated_at,workspace_id,state_revision,manual_module_order) VALUES ("
      + [projectId, "Acceptance", slug, "", 2, createdAt, createdAt, workspaceId, 0, 0]
        .map(sqlLiteral).join(",")
      + ");"
      + "INSERT INTO worktracker_issuetype "
      + "(id,name,level,color,sort_order,created_at,updated_at,project_id,start_state_id,workflow_revision,is_pathfind) VALUES "
      + `(${[moduleTypeId, "Module", "module", "", 0, createdAt, createdAt, projectId, null, 0, 0].map((value) => value === null ? "NULL" : sqlLiteral(value)).join(",")}),`
      + `(${[taskTypeId, "Task", "task", "", 1, createdAt, createdAt, projectId, null, 0, 0].map((value) => value === null ? "NULL" : sqlLiteral(value)).join(",")});`
      + "INSERT INTO worktracker_issue "
      + "(id,type,name,sequence_id,description,created_at,updated_at,project_id,state_id,is_archived,rank,state_revision,issue_type_id,parent_id,module_id) VALUES "
      + `(${[moduleId, "module", "Acceptance module", 1, "", createdAt, createdAt, projectId, null, 0, "a", 0, moduleTypeId, null, null].map((value) => value === null ? "NULL" : sqlLiteral(value)).join(",")}),`
      + `(${[taskId, "task", "Acceptance task", 2, "", createdAt, createdAt, projectId, null, 0, "a", 0, taskTypeId, moduleId, moduleId].map((value) => value === null ? "NULL" : sqlLiteral(value)).join(",")});`,
  );
  return { projectId, moduleId, taskId };
}

export async function durableAgentTerminalFlowScenario(context) {
  const tmux = await (context.findTmux ?? findTmux)();
  const identifier = `${process.pid}-${Date.now()}`;
  const runId = `acceptance-run-${identifier}`;
  const sessionName = `pt-${runId}`;
  const repository = path.join(context.sandboxRoot, "repository");
  await mkdir(repository, { recursive: true });
  const startedAt = new Date().toISOString();
  const { projectId, moduleId, taskId } = await durableFlowTargets(
    context,
    identifier,
    startedAt,
  );

  await context.run(tmux, [
    "-L",
    "muxed",
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-c",
    repository,
    "/bin/sh",
    "-c",
    "exec /bin/sleep 120",
  ], { cwd: repository, env: context.environment });
  try {
    await context.sqlite(
      context.databasePath,
      "INSERT INTO agent_runs "
        + "(id, issue_id, agent, status, "
        + "started_at, cwd, lifecycle_state, lifecycle_updated_at, scope) VALUES ("
        + [
          runId,
          taskId,
          "codex",
          "running",
          startedAt,
          repository,
          "starting",
          startedAt,
          "task",
        ].map(sqlLiteral).join(",")
        + ");"
        + "INSERT INTO agent_terminal_sessions "
        + "(agent_run_id, tmux_session_name, task_id, module_id, project_id, agent, "
        + "created_at, scope, runtime_cleanup_pending, output_sequence) VALUES ("
        + [
          runId,
          sessionName,
          taskId,
          moduleId,
          projectId,
          "codex",
          startedAt,
          "task",
          0,
          0,
        ].map(sqlLiteral).join(",")
        + ");",
    );
    const relaunched = await launchReadyApp(context);
    await context.stopApp(relaunched.child);
    const stored = await context.sqlite(
      context.databasePath,
      "SELECT r.cwd || '|' || s.tmux_session_name "
        + "FROM agent_runs r JOIN agent_terminal_sessions s ON s.agent_run_id=r.id "
        + `WHERE r.id=${sqlLiteral(runId)};`,
    );
    const tmuxResult = await context.run(
      tmux,
      ["-L", "muxed", "has-session", "-t", sessionName],
      { cwd: repository, env: context.environment, allowFailure: true },
    );
    if (stored !== `${repository}|${sessionName}`) {
      throw new InstalledArtifactDriverError(
        "repository, agent run, and terminal database rows did not survive relaunch",
      );
    }
    if (tmuxResult.code !== 0) {
      throw new InstalledArtifactDriverError(
        "durable tmux session did not survive relaunch",
      );
    }
    return true;
  } finally {
    await context.run(
      tmux,
      ["-L", "muxed", "kill-session", "-t", sessionName],
      { cwd: repository, env: context.environment, allowFailure: true },
    );
  }
}

export async function uninstallPreservesDataScenario(context) {
  const before = await stat(context.databasePath);
  await rm(context.appPath, { recursive: true, force: true });
  const after = await stat(context.databasePath);
  if (!before.isFile() || !after.isFile() || before.size !== after.size) {
    throw new InstalledArtifactDriverError("removing the app changed its external data");
  }
  return true;
}

export function pendingRuntimeEvidence() {
  return {
    rust_only_process_shape: false,
  };
}

export async function rustOnlyProcessShapeScenario(context) {
  const inspection = await inspectReleaseBundle(
    context.appPath,
    path.basename(context.executable),
  );
  if (inspection.missingExecutables.length > 0) {
    throw new InstalledArtifactDriverError(
      `installed app is missing executables: ${inspection.missingExecutables.join(", ")}`,
    );
  }
  if (inspection.unexpectedExecutables.length > 0) {
    throw new InstalledArtifactDriverError(
      `installed app contains unexpected helpers: ${inspection.unexpectedExecutables.join(", ")}`,
    );
  }
  if (inspection.forbiddenArtifacts.length > 0) {
    throw new InstalledArtifactDriverError(
      `installed app contains retired Python/REST artifacts: ${inspection.forbiddenArtifacts.join(", ")}`,
    );
  }
  return { rust_only_process_shape: true };
}

function assertRedactedDiagnostics(diagnostics) {
  for (const kind of REQUIRED_DIAGNOSTIC_KINDS) {
    if (!diagnostics.some((diagnostic) => diagnostic.kind === kind)) {
      throw new InstalledArtifactDriverError(`missing ${kind} diagnostic evidence`);
    }
  }
  for (const diagnostic of diagnostics) {
    if (!diagnostic.message?.trim() || CREDENTIAL_PATTERN.test(diagnostic.message)) {
      throw new InstalledArtifactDriverError("diagnostic is empty or contains a credential");
    }
  }
}

const AVAILABLE_SCENARIOS = [
  ["clean_install", cleanInstallScenario],
  ["upgrade_with_existing_data", upgradeWithExistingDataScenario],
  ["failed_update_recovery", failedUpdateRecoveryScenario],
  ["missing_dependency_diagnostic", missingDependencyDiagnosticScenario],
  ["os_permission_diagnostic", osPermissionDiagnosticScenario],
  ["durable_agent_terminal_flow", durableAgentTerminalFlowScenario],
  ["rust_only_process_shape", rustOnlyProcessShapeScenario],
  ["uninstall_preserves_data", uninstallPreservesDataScenario],
];

export async function runAcceptance(context) {
  const result = {
    clean_install: false,
    upgrade_with_existing_data: false,
    failed_update_recovery: false,
    uninstall_preserves_data: false,
    missing_dependency_diagnostic: false,
    os_permission_diagnostic: false,
    durable_agent_terminal_flow: false,
    ...pendingRuntimeEvidence(),
    diagnostics: context.diagnostics,
    scenario_failures: {},
  };
  for (const [name, scenario] of AVAILABLE_SCENARIOS) {
    try {
      const evidence = await scenario(context);
      if (name === "rust_only_process_shape") {
        Object.assign(result, evidence);
      } else {
        result[name] = evidence === true;
      }
    } catch (error) {
      if (name !== "rust_only_process_shape") result[name] = false;
      const message = error instanceof Error ? error.message : "unknown scenario failure";
      result.scenario_failures[name] = CREDENTIAL_PATTERN.test(message)
        ? "scenario failure details redacted"
        : message.slice(0, 1_000);
    }
  }
  assertRedactedDiagnostics(result.diagnostics);
  return result;
}

async function createContext(appPath, environment = process.env) {
  const home = path.resolve(environment.HOME ?? "");
  const sandboxRoot = path.dirname(home);
  const dataDirectory = path.resolve(environment.MUXED_DATA_DIR ?? "");
  const resultPath = path.resolve(environment.MUXED_DESKTOP_ACCEPTANCE_RESULT ?? "");
  const resolvedAppPath = path.resolve(appPath);
  await Promise.all([
    requireSandboxPath(sandboxRoot, home, "HOME", { mustExist: true }),
    requireSandboxPath(sandboxRoot, dataDirectory, "MUXED_DATA_DIR"),
    requireSandboxPath(sandboxRoot, resultPath, "MUXED_DESKTOP_ACCEPTANCE_RESULT"),
    requireSandboxPath(sandboxRoot, resolvedAppPath, "installed app", { mustExist: true }),
  ]);
  const executable = await findAppExecutable(resolvedAppPath);
  return {
    appPath: resolvedAppPath,
    dataDirectory,
    databasePath: path.join(dataDirectory, "state.db"),
    diagnostics: [],
    environment,
    executable,
    resultPath,
    run: runCommand,
    sandboxRoot,
    sqlite,
    startApp,
    stopApp,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    waitFor,
  };
}

async function main() {
  const [appPath, ...extra] = process.argv.slice(2);
  if (!appPath || extra.length > 0) {
    throw new InstalledArtifactDriverError(
      "usage: installed-artifact-acceptance-driver <installed.app>",
    );
  }
  const context = await createContext(appPath);
  const result = await runAcceptance(context);
  await writeFile(context.resultPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
