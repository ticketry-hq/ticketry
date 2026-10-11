import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, appendFile, access } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withProviderMcp } from "./provider-mcp.mjs";

async function waitForFile(path) {
  for (let attempt = 0; ; attempt++) {
    if (await access(path).then(() => true, () => false)) return;
    if (attempt > 1200) throw new Error(`Fixture signal timed out: ${path}`);
    await delay(100);
  }
}

// Real interactive provider subprocess: publish lifecycle through the shipping
// hook command. The browser still talks only to the production backend.
export async function runWorkspaceProvider(root, args) {
  const hooks = args.find(value => value.startsWith("hooks=")) ?? "";
  const match = hooks.match(/command=("(?:[^"\\]|\\.)*")/);
  if (!match) throw new Error("Missing production lifecycle hook");
  const resume = args.indexOf("resume");
  const sessionId = resume >= 0 ? args.filter(value => !value.startsWith("-" ) && !value.includes("=")).at(-1) : randomUUID();
  const config = args.find(value => value.startsWith("mcp_servers=")) ?? "";
  const bridgeArgsMatch = config.match(/args=(\[.*?\]),command=/);
  const bridgeArgs = bridgeArgsMatch ? JSON.parse(bridgeArgsMatch[1]) : [];
  const runId = bridgeArgs[bridgeArgs.indexOf("--agent-run-id") + 1];
  root ??= join(bridgeArgs[bridgeArgs.indexOf("--data-dir") + 1], "provider-fixture");
  await writeFile(join(root, "interactive-startup.json"), JSON.stringify({ runId, hasHook: !!match, pid: process.pid }));
  if (!runId) throw new Error("Missing credentialed provider run identity");
  let control;
  try { control = JSON.parse(await readFile(join(root, "agent-control.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  function withBridge(body) {
    const command = config.match(/command=("(?:[^"\\]|\\.)*")/);
    if (!command) throw new Error("Missing fixture MCP command");
    return withProviderMcp(JSON.parse(command[1]), bridgeArgs, body);
  }
  // Recorded calls may be refused; the test reads each structured result.
  async function recordCallsWith(request, calls) {
    for (const call of calls) {
      const response = await request("tools/call", call);
      await appendFile(join(root, `${runId}.calls.log`), JSON.stringify({ name: call.name, response }) + "\n");
    }
  }
  const recordCalls = calls => withBridge(request => recordCallsWith(request, calls));
  async function emitHook(event) {
    const result = spawnSync("/bin/sh", ["-c", JSON.parse(match[1])], {
      input: JSON.stringify({ hook_event_name: event, session_id: sessionId }),
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(`Provider hook failed: ${result.stderr}`);
    await appendFile(join(root, `${runId}.hooks.log`), event + "\n");
  }
  await emitHook("SessionStart");
  await emitHook("UserPromptSubmit");
  await writeFile(join(root, `${runId}.interactive.json`), JSON.stringify({ runId, sessionId, args, pid: process.pid, cwd: process.cwd() }));
  console.log(`Ticketry workspace fixture ready ${sessionId}`);
  // The shipping delivery service recognizes Codex's composer marker and
  // verifies pasted text in the real tmux pane. The PTY echoes its input.
  if (!control?.suppressReady) console.log("› Ask Codex");
  // Requested provider events go through the same production hook command.
  for (const event of control?.hooks ?? []) await emitHook(event);
  // Start calls run while the provider stays live; the bridge then disconnects.
  if (control?.startCalls?.length) await recordCalls(control.startCalls);
  process.stdin.resume();
  // Termination belongs to the production terminal lifecycle; no successful
  // application state is injected by this fixture.
  if (!control || control.mode === "hold") { for (;;) await delay(250); }
  if (!["success", "failure"].includes(control.mode)) throw new Error("Invalid interactive fixture mode");
  for (let attempt = 0; ; attempt++) {
    const released = await Promise.any([access(join(root, `${runId}.release`)), access(join(root, "agent.release"))]).then(() => true, () => false);
    if (released || control.autoRelease) break;
    if (attempt > 1200) throw new Error("Interactive fixture release timed out");
    await delay(100);
  }
  const prompt = args.at(-1) ?? "";
  const taskId = control.taskId ?? prompt.match(/^Work Item ID: (.+)$/m)?.[1];
  const projectId = control.projectId ?? prompt.match(/^Project ID: (.+)$/m)?.[1];
  if (control.states?.length || control.calls?.length) {
    if (!taskId || !projectId) throw new Error("Missing fixture work item identity");
    await withBridge(async request => {
      await recordCallsWith(request, control.calls ?? []);
      for (const state of control.states ?? []) {
        // Step-gated journeys release each move separately so the browser can
        // observe every intermediate state before the next one is written.
        if (control.stepSignals) await waitForFile(join(root, `${runId}.advance-${state}`));
        const response = await request("tools/call", { name: "update_task_status", arguments: { project_id: projectId, task_id: taskId, status_name: state } });
        const serialized = JSON.stringify(response);
        await appendFile(join(root, `${runId}.mcp.log`), serialized + "\n");
        if (!serialized.includes('"ok":true')) throw new Error(`Fixture MCP refused ${state}: ${serialized}`);
        await emitHook("PostToolUse");
      }
    });
  }
  await emitHook("Stop");
  console.log(`Ticketry workspace fixture ${control.mode}`);
  process.exitCode = control.mode === "failure" ? 23 : 0;
}
