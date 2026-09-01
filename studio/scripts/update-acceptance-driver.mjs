/**
 * Drives one packaged update acceptance case and records what only an outside
 * observer can see.
 *
 * The app itself reports discovery, installation, refusal, and the relaunch —
 * it is the only thing that can, because those happen inside the update path.
 * This driver owns the rest: it seeds the data an update must preserve, cold
 * launches version A, waits for the run to finish, and then checks that the
 * data survived and that nothing was left running behind.
 */
import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findAppExecutable } from "./installed-artifact-acceptance-driver.mjs";

export class UpdateAcceptanceDriverError extends Error {}

const LAUNCH_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 500;

/** The marker row an update must still be able to read afterwards. */
export const PRESERVED_WORK_ITEM_NAME = "update acceptance preserved work item";

export function requiredDriverEnvironment(environment) {
  const missing = [
    "TICKETRY_UPDATE_ACCEPTANCE_RESULT",
    "TICKETRY_UPDATE_ACCEPTANCE_EXPECTED_VERSION",
    "TICKETRY_UPDATE_ACCEPTANCE_CASE",
    "TICKETRY_UPDATE_FEED_URL",
    "MUXED_DATA_DIR",
  ].filter((key) => !environment[key]);
  if (missing.length > 0) {
    throw new UpdateAcceptanceDriverError(
      `update acceptance driver requires ${missing.join(", ")}`,
    );
  }
  if (environment.MUXED_DESKTOP_ACCEPTANCE_EXIT_AFTER_STARTUP) {
    throw new UpdateAcceptanceDriverError(
      "the update run needs the app to stay alive past startup; "
        + "MUXED_DESKTOP_ACCEPTANCE_EXIT_AFTER_STARTUP must not be set",
    );
  }
  return {
    resultPath: environment.TICKETRY_UPDATE_ACCEPTANCE_RESULT,
    expectedVersion: environment.TICKETRY_UPDATE_ACCEPTANCE_EXPECTED_VERSION,
    feedCase: environment.TICKETRY_UPDATE_ACCEPTANCE_CASE,
    dataDirectory: environment.MUXED_DATA_DIR,
  };
}

/** Statements that plant the data the preservation cases look for. */
export function seedStatements(now = "2026-08-31T00:00:00Z") {
  const identifier = "aaaaaaaaaaaaaaaaaaaaaaaaupdateacc";
  return [
    "CREATE TABLE IF NOT EXISTS ticketry_update_acceptance_seed ("
      + "id TEXT PRIMARY KEY, name TEXT NOT NULL, seeded_at TEXT NOT NULL);",
    "INSERT OR REPLACE INTO ticketry_update_acceptance_seed (id, name, seeded_at) "
      + `VALUES ('${identifier}', '${PRESERVED_WORK_ITEM_NAME}', '${now}');`,
  ];
}

export function seedProbeStatement() {
  return "SELECT count(*) FROM ticketry_update_acceptance_seed WHERE name="
    + `'${PRESERVED_WORK_ITEM_NAME}';`;
}

/**
 * The preservation evidence, from what the driver planted and then observed.
 *
 * Every entry the release manifest promises to preserve has to be asserted
 * separately: a relaunch that keeps the database but loses the selected
 * workspace is still a failed update.
 */
export function preservationEvidence({
  seededWorkItems,
  observedWorkItems,
  seededWorkspace,
  observedWorkspace,
  seededApprovals,
  observedApprovals,
  seededPreferences,
  observedPreferences,
}) {
  const dataPreserved =
    Number(seededWorkItems) > 0 && Number(observedWorkItems) >= Number(seededWorkItems);
  return {
    work_tracker_data_preserved: dataPreserved,
    selected_workspace_restored:
      Boolean(seededWorkspace) && observedWorkspace === seededWorkspace,
    approved_paths_and_preferences_preserved:
      Boolean(seededApprovals)
      && observedApprovals === seededApprovals
      && Boolean(seededPreferences)
      && observedPreferences === seededPreferences,
  };
}

/**
 * Whether the relaunch left anything of the old process behind.
 *
 * The updated app owns its sandbox alone, so any surviving process still
 * pointing at the run's sandbox root is a stranded child — the failure the
 * restart teardown exists to prevent.
 */
export function strandedProcessEvidence(processListing, { sandboxRoot, driverPid }) {
  const stranded = processListing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .filter((line) => line.includes(sandboxRoot))
    .filter((line) => Number(line.split(/\s+/)[0]) !== Number(driverPid));
  return {
    no_stranded_processes: stranded.length === 0,
    ...(stranded.length === 0
      ? {}
      : {
          case_failures: {
            no_stranded_processes: `${stranded.length} process(es) survived the update relaunch`,
          },
        }),
  };
}

export function mergeDriverEvidence(existing, evidence) {
  const merged =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  for (const [key, value] of Object.entries(evidence)) {
    if (key === "case_failures") {
      merged.case_failures = { ...(merged.case_failures ?? {}), ...value };
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function runCommand(command, arguments_, { cwd, env, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.resume();
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ stdout });
      else {
        reject(
          new UpdateAcceptanceDriverError(
            `${path.basename(command)} failed (${code ?? signal})`,
          ),
        );
      }
    });
    child.stdin.end(input ?? "");
  });
}

async function sqlite(databasePath, sql, run = runCommand) {
  const result = await run("/usr/bin/sqlite3", ["-batch", "-noheader", databasePath, sql], {
    cwd: path.dirname(databasePath),
  });
  return result.stdout.trim();
}

async function waitForExit(child, timeoutMs = LAUNCH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode === null && child.signalCode === null) {
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new UpdateAcceptanceDriverError(
        "the packaged update run did not finish before its deadline",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  if (child.signalCode !== null) {
    throw new UpdateAcceptanceDriverError(
      `the packaged update run ended with ${child.signalCode}`,
    );
  }
  return child.exitCode;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

export async function runUpdateAcceptanceDriver({
  appPath,
  environment = process.env,
  sandboxRoot = process.cwd(),
  run = runCommand,
  launch = spawn,
}) {
  const { resultPath, dataDirectory } = requiredDriverEnvironment(environment);
  const databasePath = path.join(dataDirectory, "state.db");
  const approvalsPath = path.join(dataDirectory, "approved-executables.json");
  const preferencesPath = path.join(dataDirectory, "update-acceptance-preferences.json");
  const workspacePath = path.join(dataDirectory, "session-marker.json");

  const executable = await findAppExecutable(appPath, run);
  // Version A has to have run once for there to be data an update can
  // preserve, and that first launch is bounded by the startup-exit switch.
  await access(databasePath).catch(async () => {
    const first = launch(executable, [], {
      cwd: sandboxRoot,
      env: { ...environment, MUXED_DESKTOP_ACCEPTANCE_EXIT_AFTER_STARTUP: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    first.stdout?.resume();
    first.stderr?.resume();
    await waitForExit(first);
    await access(databasePath).catch(() => {
      throw new UpdateAcceptanceDriverError(
        "version A did not create its data directory on a first bounded launch",
      );
    });
  });

  for (const statement of seedStatements()) {
    await sqlite(databasePath, statement, run);
  }
  const seededApprovals = JSON.stringify({ approved: ["/usr/bin/true"] });
  const seededPreferences = JSON.stringify({ selected_workspace: "update-acceptance" });
  const seededWorkspace = JSON.stringify({ workspace: "update-acceptance" });
  await writeFile(approvalsPath, seededApprovals);
  await writeFile(preferencesPath, seededPreferences);
  await writeFile(workspacePath, seededWorkspace);
  const seededWorkItems = await sqlite(databasePath, seedProbeStatement(), run);

  const child = launch(executable, [], {
    cwd: sandboxRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  await waitForExit(child);

  const observedWorkItems = await sqlite(databasePath, seedProbeStatement(), run);
  const evidence = {
    ...preservationEvidence({
      seededWorkItems,
      observedWorkItems,
      seededWorkspace,
      observedWorkspace: await readFile(workspacePath, "utf8").catch(() => undefined),
      seededApprovals,
      observedApprovals: await readFile(approvalsPath, "utf8").catch(() => undefined),
      seededPreferences,
      observedPreferences: await readFile(preferencesPath, "utf8").catch(() => undefined),
    }),
    ...strandedProcessEvidence(
      (await run("/bin/ps", ["-Ao", "pid,command"], { cwd: sandboxRoot })).stdout,
      { sandboxRoot, driverPid: process.pid },
    ),
  };

  const merged = mergeDriverEvidence(await readJson(resultPath), evidence);
  await writeFile(resultPath, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

async function main() {
  const [appPath] = process.argv.slice(2);
  if (!appPath) {
    throw new UpdateAcceptanceDriverError(
      "the update acceptance driver requires the installed .app path",
    );
  }
  await runUpdateAcceptanceDriver({ appPath });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
