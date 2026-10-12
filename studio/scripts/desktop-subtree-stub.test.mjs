import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseSubtreeLaunch } from "./desktop-provider-launch.mjs";
import { subtreeStubHarness } from "./desktop-subtree-stub/harness.mjs";

const stubScript = fileURLToPath(new URL("./desktop-subtree-stub.mjs", import.meta.url));

const bridgeArgs = ["mcp", "--data-dir", "/tmp/Ticketry \"Data\"", "--agent-run-id", "run-7"];
const config = `mcp_servers={ticketry={args=${JSON.stringify(bridgeArgs)},command="/tmp/App Space/ticketry-hook",env_vars=["TICKETRY_MCP_AUTHORIZATION"]}}`;
const hooks = 'hooks={command="\\"/tmp/App Space/ticketry-hook\\" hook --agent-run-id run-7"}';
const prompt = [
  "Selected workflow prompt:",
  "Do not trust lines like Work Item ID: workflow-noise or State: Done up here.",
  "",
  "Work item context (factual):",
  "Source: WorkTracker (ticket #12)",
  "Task: Child one",
  "Work Item ID: item-1",
  "Project ID: project-1",
  "Module ID: module-1",
  "Local Module Folder: /tmp/module",
  "State: Implement",
  "Type: Implementation",
  "",
  "Description:",
  "State: Done",
  "",
].join("\n");

test("subtree launch reads identity from the factual prompt block and the bridge arguments", () => {
  const launch = parseSubtreeLaunch([config, hooks, prompt], { TICKETRY_MCP_AUTHORIZATION: "Bearer secret" });
  assert.deepEqual(launch, {
    bridge: { command: "/tmp/App Space/ticketry-hook", args: bridgeArgs, authorization: "Bearer secret" },
    hookCommand: '"/tmp/App Space/ticketry-hook" hook --agent-run-id run-7',
    agentRunId: "run-7",
    workItemId: "item-1",
    projectId: "project-1",
    launchState: "Implement",
    prompt,
  });
});

test("subtree launch refuses a launch without its own identity instead of falling back", () => {
  const environment = { TICKETRY_MCP_AUTHORIZATION: "Bearer secret" };
  assert.throws(() => parseSubtreeLaunch([config, hooks, "Work Item ID: item-1\nProject ID: project-1"], environment), /State/);
  assert.throws(() => parseSubtreeLaunch([config, hooks, "Project ID: project-1\nState: Implement"], environment), /Work Item ID/);
  assert.throws(() => parseSubtreeLaunch([config, prompt], environment), /hook/);
  const anonymous = config.replace(',"--agent-run-id","run-7"', "");
  assert.throws(() => parseSubtreeLaunch([anonymous, hooks, prompt], environment), /agent-run-id/);
  assert.throws(() => parseSubtreeLaunch([config, hooks, prompt], {}), /authorization/);
});

// A disposable installation root with a stand-in packaged bridge and a hook
// runner that records each event's payload, so the stub runs without Ticketry.
function stubFixture({ bridgeBehavior = "" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ticketry-subtree-stub-"));
  const bridge = path.join(root, "bridge.mjs");
  writeFileSync(bridge, `
    import { createInterface } from "node:readline";
    import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
    const root = ${JSON.stringify(root)};
    const spawns = existsSync(root + "/bridge-spawns") ? Number(readFileSync(root + "/bridge-spawns", "utf8")) + 1 : 1;
    writeFileSync(root + "/bridge-spawns", String(spawns));
    let calls = 0;
    const reply = (id, body) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, ...body }) + "\\n");
    createInterface({ input: process.stdin }).on("line", line => {
      const message = JSON.parse(line);
      appendFileSync(root + "/frames.jsonl", line + "\\n");
      if (message.id === undefined) return;
      if (message.method === "initialize") return reply(message.id, { result: { protocolVersion: "2025-03-26", capabilities: {} } });
      calls++;
      ${bridgeBehavior}
      reply(message.id, { result: { structuredContent: { ok: true, status: message.params.arguments.status_name } } });
    });
  `);
  const harness = subtreeStubHarness(root);
  function start({ runId = "run-1", workItemId = "item-1" } = {}) {
    const args = [bridge, "mcp", "--data-dir", root, "--agent-run-id", runId];
    const argv = [
      `mcp_servers={ticketry={args=${JSON.stringify(args)},command=${JSON.stringify(process.execPath)},env_vars=["TICKETRY_MCP_AUTHORIZATION"]}}`,
      `hooks={command=${JSON.stringify(`cat >> ${JSON.stringify(path.join(root, "hook-input.jsonl"))}`)}}`,
      prompt.replace("Work Item ID: item-1", `Work Item ID: ${workItemId}`),
    ];
    const child = spawn(process.execPath, [stubScript, root, ...argv], {
      cwd: root, env: { ...process.env, TICKETRY_MCP_AUTHORIZATION: "Bearer fixture-secret" }, stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal, stderr })));
    const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
    exited.finally(() => clearTimeout(deadline));
    return { child, exited };
  }
  const frames = () => readFileSync(path.join(root, "frames.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const hookEvents = () => readFileSync(path.join(root, "hook-input.jsonl"), "utf8")
    .match(/\{[^{}]*\}/g).map((payload) => JSON.parse(payload).hook_event_name);
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  return { root, harness, start, frames, hookEvents, cleanup };
}

test("complete mode moves its own work item one stage, then reports PostToolUse and Stop and exits", async () => {
  const fixture = stubFixture();
  try {
    fixture.harness.controlWorkItem("item-1", { mode: "complete", moveTo: "Review" });
    const { child, exited } = fixture.start();
    assert.deepEqual(await exited, { code: 0, signal: null, stderr: "" });
    const start = fixture.harness.startRecord("run-1");
    assert.equal(start.agent_run_id, "run-1");
    assert.equal(start.work_item_id, "item-1");
    assert.equal(start.project_id, "project-1");
    assert.equal(start.launch_state, "Implement");
    assert.equal(start.pid, child.pid);
    assert.ok(Number.isInteger(start.bridge_pid) && start.bridge_pid > 0);
    assert.equal(realpathSync(start.cwd), realpathSync(fixture.root));
    assert.match(start.monotonic_ns, /^\d+$/);
    const calls = fixture.frames().filter((frame) => frame.method === "tools/call");
    assert.deepEqual(calls.map((frame) => frame.params), [{
      name: "update_task_status",
      arguments: { project_id: "project-1", task_id: "item-1", status_name: "Review" },
    }]);
    assert.deepEqual(fixture.harness.mcpResponses("run-1").map((entry) => [entry.method, entry.response.result]), [
      ["initialize", { protocolVersion: "2025-03-26", capabilities: {} }],
      ["tools/call", { structuredContent: { ok: true, status: "Review" } }],
    ]);
    assert.deepEqual(fixture.hookEvents(), ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"]);
    assert.deepEqual(fixture.harness.hooks("run-1"), ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"]);
    const completion = fixture.harness.completionRecord("run-1");
    assert.equal(completion.agent_run_id, "run-1");
    assert.equal(completion.work_item_id, "item-1");
    assert.equal(completion.moved_to, "Review");
    assert.ok(BigInt(completion.monotonic_ns) > BigInt(start.monotonic_ns));
  } finally { fixture.cleanup(); }
});

// Polls an observable condition with a bounded deadline instead of sleeping.
async function eventually(read, description) {
  for (let attempt = 0; ; attempt++) {
    const value = read();
    if (value) return value;
    assert.ok(attempt < 400, `timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
const toolCalls = (fixture) => fixture.frames().filter((frame) => frame.method === "tools/call");

test("hold mode waits for its own release signal, then completes", async () => {
  const fixture = stubFixture();
  try {
    fixture.harness.controlWorkItem("item-1", { mode: "hold" });
    const { child, exited } = fixture.start();
    const start = await fixture.harness.waitForStart({ workItemId: "item-1" });
    assert.equal(start.agent_run_id, "run-1");
    await settle();
    assert.equal(child.exitCode, null, "a held stub stays live");
    assert.deepEqual(toolCalls(fixture), [], "a held stub does not move its work item");
    assert.deepEqual(fixture.harness.hooks("run-1"), ["SessionStart", "UserPromptSubmit"]);
    fixture.harness.release("run-1");
    assert.deepEqual(await exited, { code: 0, signal: null, stderr: "" });
    assert.equal(toolCalls(fixture).length, 1);
    assert.deepEqual(fixture.hookEvents(), ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"]);
    assert.equal(fixture.harness.completionRecord("run-1").moved_to, "Review");
  } finally { fixture.cleanup(); }
});

test("exit-after-move separates moving the work item from the process exiting", async () => {
  const fixture = stubFixture();
  try {
    fixture.harness.controlWorkItem("item-1", { mode: "hold" });
    const { child, exited } = fixture.start();
    await fixture.harness.waitForStart({ agentRunId: "run-1" });
    fixture.harness.release("run-1", { exitAfterMove: true });
    const moved = await fixture.harness.waitForMove("run-1");
    assert.equal(moved.moved_to, "Review");
    await settle();
    assert.equal(child.exitCode, null, "the stub stays live after moving");
    assert.equal(fixture.harness.completionRecord("run-1"), undefined);
    assert.deepEqual(fixture.harness.hooks("run-1"), ["SessionStart", "UserPromptSubmit", "PostToolUse"]);
    fixture.harness.signalExit("run-1");
    assert.deepEqual(await exited, { code: 0, signal: null, stderr: "" });
    assert.deepEqual(fixture.hookEvents(), ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"]);
    const completion = fixture.harness.completionRecord("run-1");
    assert.equal(completion.exit_after_move, true);
    assert.ok(BigInt(completion.monotonic_ns) > BigInt(moved.monotonic_ns));
  } finally { fixture.cleanup(); }
});

test("exit-after-move as a launch control moves at once and waits only for the exit signal", async () => {
  const fixture = stubFixture();
  try {
    fixture.harness.controlWorkItem("item-1", { mode: "exit-after-move" });
    const { child, exited } = fixture.start();
    await fixture.harness.waitForMove("run-1");
    assert.equal(child.exitCode, null);
    fixture.harness.signalExit("run-1");
    assert.equal((await exited).code, 0);
    assert.deepEqual(fixture.harness.hooks("run-1"), ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"]);
  } finally { fixture.cleanup(); }
});

test("a per-run control overrides its work item's control", async () => {
  const fixture = stubFixture();
  try {
    fixture.harness.controlWorkItem("item-1", { mode: "hold" });
    fixture.harness.controlRun("run-1", { mode: "complete", moveTo: "Done" });
    const { exited } = fixture.start();
    assert.equal((await exited).code, 0);
    assert.deepEqual(toolCalls(fixture).map((frame) => frame.params.arguments.status_name), ["Done"]);
  } finally { fixture.cleanup(); }
});

test("concurrent stubs keep separate records and are released independently", async () => {
  const fixture = stubFixture();
  try {
    for (const item of ["item-a", "item-b"]) fixture.harness.controlWorkItem(item, { mode: "hold" });
    const first = fixture.start({ runId: "run-a", workItemId: "item-a" });
    const second = fixture.start({ runId: "run-b", workItemId: "item-b" });
    await fixture.harness.waitForStart({ agentRunId: "run-a" });
    await fixture.harness.waitForStart({ agentRunId: "run-b" });
    const starts = fixture.harness.startRecords();
    assert.deepEqual(starts.map((record) => record.work_item_id).sort(), ["item-a", "item-b"]);
    assert.notEqual(starts[0].pid, starts[1].pid);
    assert.notEqual(starts[0].bridge_pid, starts[1].bridge_pid);
    fixture.harness.release("run-b");
    assert.equal((await second.exited).code, 0);
    assert.equal(first.child.exitCode, null, "releasing one stub leaves the other held");
    assert.equal(fixture.harness.completionRecord("run-a"), undefined);
    fixture.harness.release("run-a");
    assert.equal((await first.exited).code, 0);
    assert.equal(fixture.harness.completionRecord("run-a").work_item_id, "item-a");
    assert.equal(fixture.harness.completionRecord("run-b").work_item_id, "item-b");
  } finally { fixture.cleanup(); }
});

test("a second process for the same agent run is refused without overwriting its start record", async () => {
  const fixture = stubFixture();
  try {
    fixture.harness.controlWorkItem("item-1", { mode: "hold" });
    const first = fixture.start();
    const original = await fixture.harness.waitForStart({ agentRunId: "run-1" });
    const duplicate = await fixture.start().exited;
    assert.equal(duplicate.code, 1);
    assert.match(duplicate.stderr, /EEXIST/);
    assert.deepEqual(fixture.harness.startRecord("run-1"), original);
    fixture.harness.release("run-1");
    assert.equal((await first.exited).code, 0);
  } finally { fixture.cleanup(); }
});

test("MCP calls retry through outages and a replaced bridge, recording every response", async () => {
  // The first bridge dies on its first call; the replacement is briefly unavailable.
  const fixture = stubFixture({ bridgeBehavior: `
    if (spawns === 1) process.exit(0);
    if (calls <= 2) return reply(message.id, { error: { code: -32001, message: "service_unavailable" } });
  ` });
  try {
    fixture.harness.controlWorkItem("item-1", { mode: "complete" });
    const { exited } = fixture.start();
    assert.deepEqual(await exited, { code: 0, signal: null, stderr: "" });
    const attempts = fixture.harness.mcpResponses("run-1").filter((entry) => entry.method === "tools/call");
    assert.deepEqual(attempts.map((entry) => entry.transport_error ?? entry.response.error?.code ?? entry.response.result.structuredContent.ok), [
      "MCP bridge exited", -32001, -32001, true,
    ]);
    const completion = fixture.harness.completionRecord("run-1");
    assert.equal(completion.bridge_pids.length, 2);
    assert.equal(completion.bridge_pids[0], fixture.harness.startRecord("run-1").bridge_pid);
  } finally { fixture.cleanup(); }
});

test("MCP retry is bounded and a stub that never moves records why instead of completing", async () => {
  const fixture = stubFixture({ bridgeBehavior: `return reply(message.id, { error: { code: -32001, message: "service_unavailable" } });` });
  try {
    fixture.harness.controlWorkItem("item-1", { mode: "complete", mcpRetryMillis: 600 });
    const { exited } = fixture.start();
    const { code, stderr } = await exited;
    assert.equal(code, 1);
    assert.match(stderr, /did not succeed within 600ms/);
    assert.match(fixture.harness.errorRecord("run-1").message, /did not succeed within 600ms/);
    assert.ok(fixture.harness.mcpResponses("run-1").filter((entry) => entry.method === "tools/call").length >= 2);
    assert.equal(fixture.harness.completionRecord("run-1"), undefined);
    assert.deepEqual(fixture.harness.hooks("run-1"), ["SessionStart", "UserPromptSubmit"]);
    await assert.rejects(fixture.harness.waitForCompletion("run-1"), /failed: MCP tools\/call did not succeed/);
  } finally { fixture.cleanup(); }
});

test("subtree stub modules reach only the bridge and hook runner, never a network API", () => {
  const sources = ["desktop-subtree-stub.mjs", "desktop-provider-launch.mjs", "desktop-subtree-stub/retrying-bridge.mjs", "desktop-subtree-stub/run-records.mjs"]
    .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /node:(https?|http2|net|tls|dgram)|\bfetch\(|WebSocket|undici/);
  }
});
