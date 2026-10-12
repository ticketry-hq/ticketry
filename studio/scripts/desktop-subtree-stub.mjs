import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { parseSubtreeLaunch } from "./desktop-provider-launch.mjs";
import { openRetryingBridge } from "./desktop-subtree-stub/retrying-bridge.mjs";
import { DEFAULT_NEXT_STAGE, monotonicNow, SUBTREE_STUB_MODES, subtreeStubPaths } from "./desktop-subtree-stub/run-records.mjs";

const DEFAULT_MCP_RETRY_MILLIS = 120_000;
const DEFAULT_SIGNAL_TIMEOUT_MILLIS = 15 * 60_000;

/**
 * Subtree mode of the disposable `codex`-compatible desktop provider. Each
 * stub completes exactly one stage for its own work item through the
 * run-scoped Ticketry MCP, then exits; the harness scripts its timing through
 * the per-run controls and signals described in `run-records.mjs`.
 *
 * Its identity comes only from its own launch, so any number of stubs can run
 * at once. It talks to nothing but the packaged bridge and hook runner.
 */
export async function runSubtreeStub(root, argv) {
  if (argv[0] === "--version") {
    console.log("codex-cli 0.0.0-ticketry-subtree-stub");
    return;
  }
  const launch = parseSubtreeLaunch(argv, process.env);
  const stubPaths = subtreeStubPaths(root);
  const run = stubPaths.run(launch.agentRunId);
  mkdirSync(run.directory, { recursive: true });
  const identity = {
    agent_run_id: launch.agentRunId, work_item_id: launch.workItemId,
    project_id: launch.projectId, launch_state: launch.launchState,
  };
  try {
    await completeOneStage({ launch, run, stubPaths, identity });
  } catch (error) {
    writeFileSync(run.error, JSON.stringify({ ...identity, message: error.message, monotonic_ns: monotonicNow() }));
    throw error;
  }
}

async function completeOneStage({ launch, run, stubPaths, identity }) {
  const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined);
  // A per-run control overrides the work-item control; no control holds.
  function readControl() {
    const control = readJson(run.control) ?? readJson(stubPaths.workItemControl(launch.workItemId)) ?? { mode: "hold" };
    if (!SUBTREE_STUB_MODES.includes(control.mode)) throw new Error(`Unknown subtree stub mode ${control.mode}`);
    return control;
  }
  async function waitForSignal(file, timeoutMillis) {
    const deadline = Date.now() + timeoutMillis;
    while (!existsSync(file)) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path.basename(file)}`);
      await delay(100);
    }
    const contents = readFileSync(file, "utf8");
    return contents ? JSON.parse(contents) : {};
  }
  function emitHook(event) {
    const result = spawnSync("/bin/sh", ["-c", launch.hookCommand], {
      input: JSON.stringify({ hook_event_name: event, session_id: `ticketry-subtree-stub-${launch.agentRunId}` }),
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(`Lifecycle hook ${event} failed: ${result.stderr}`);
    appendFileSync(run.hooks, `${event}\n`);
  }

  let control = readControl();
  const retryMillis = () => control.mcpRetryMillis ?? DEFAULT_MCP_RETRY_MILLIS;
  const signalTimeoutMillis = () => control.signalTimeoutMillis ?? DEFAULT_SIGNAL_TIMEOUT_MILLIS;
  const bridge = openRetryingBridge({
    command: launch.bridge.command, args: launch.bridge.args, clientName: "ticketry-subtree-stub",
    record: (entry) => appendFileSync(run.mcp, `${JSON.stringify({ ...entry, monotonic_ns: monotonicNow() })}\n`),
  });
  try {
    const bridgePid = await bridge.connect({ retryMillis: retryMillis() });
    const start = { ...identity, pid: process.pid, bridge_pid: bridgePid, cwd: process.cwd(), monotonic_ns: monotonicNow(), started_at: new Date().toISOString() };
    // `wx`: a second process for the same run is a duplicate, never an overwrite.
    writeFileSync(run.start, JSON.stringify(start), { flag: "wx" });
    console.log(`Ticketry subtree stub started for ${launch.workItemId}`);
    emitHook("SessionStart");
    emitHook("UserPromptSubmit");

    let exitAfterMove = control.mode === "exit-after-move";
    if (control.mode === "hold") {
      const release = await waitForSignal(run.release, signalTimeoutMillis());
      control = readControl();
      exitAfterMove = release.exitAfterMove === true;
    }
    const moveTo = control.moveTo ?? DEFAULT_NEXT_STAGE[launch.launchState];
    if (!moveTo) throw new Error(`No next stage after ${launch.launchState}`);
    const response = await bridge.callTool("update_task_status", {
      project_id: launch.projectId, task_id: launch.workItemId, status_name: moveTo,
    }, { retryMillis: retryMillis() });
    if (!JSON.stringify(response).includes('"ok":true')) throw new Error(`Ticketry MCP refused ${moveTo}: ${JSON.stringify(response)}`);
    writeFileSync(run.moved, JSON.stringify({ ...identity, moved_to: moveTo, bridge_pid: bridge.pid, monotonic_ns: monotonicNow() }));
    emitHook("PostToolUse");

    if (exitAfterMove) await waitForSignal(run.exit, signalTimeoutMillis());
    emitHook("Stop");
    bridge.close();
    writeFileSync(run.completion, JSON.stringify({
      ...identity, moved_to: moveTo, exit_after_move: exitAfterMove, pid: process.pid, bridge_pids: bridge.pids,
      cwd: process.cwd(), start_monotonic_ns: start.monotonic_ns, monotonic_ns: monotonicNow(), ended_at: new Date().toISOString(),
    }));
    console.log(`Ticketry subtree stub completed ${launch.workItemId} to ${moveTo}`);
  } finally {
    bridge.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSubtreeStub(process.argv[2], process.argv.slice(3)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
