import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("disposable provider answers the resident title protocol without a model", () => {
  const result = spawnSync(process.execPath, [new URL("sprint-provider.mjs", import.meta.url).pathname, "app-server", "--stdio"], {
    input: [
      { id: 1, method: "initialize", params: {} },
      { id: 2, method: "thread/read", params: { threadId: "fixture-thread" } },
      { id: 3, method: "thread/name/set", params: { threadId: "fixture-thread", name: "Renamed fixture" } },
      { id: 4, method: "thread/read", params: { threadId: "fixture-thread" } },
    ].map(value => JSON.stringify(value)).join("\n") + "\n",
    encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  const replies = result.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(replies[1].result.thread.name, "Fixture conversation title");
  assert.equal(replies[3].result.thread.name, "Renamed fixture");
});

test("interactive fixture reports real hook events and controlled process failure", () => {
  const root = mkdtempSync(join(tmpdir(), "ticketry-provider-contract-"));
  try {
    writeFileSync(join(root, "agent-control.json"), JSON.stringify({ mode: "failure", autoRelease: true }));
    const result = spawnSync(process.execPath, [new URL("sprint-provider.mjs", import.meta.url).pathname,
      'hooks={command="cat >/dev/null"}',
      `mcp_servers={args=${JSON.stringify(["mcp", "--data-dir", root, "--agent-run-id", "fixture-run"])},command="unused"}`,
    ], { cwd: root, env: { ...process.env, TICKETRY_E2E_PROVIDER_DIR: root }, encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 23, result.stderr);
    assert.match(result.stdout, /workspace fixture failure/);
    assert.equal(readFileSync(join(root, "fixture-run.hooks.log"), "utf8"), "SessionStart\nUserPromptSubmit\nStop\n");
    const evidence = JSON.parse(readFileSync(join(root, "fixture-run.interactive.json"), "utf8"));
    assert.equal(evidence.runId, "fixture-run");
    assert.equal(realpathSync(evidence.cwd), realpathSync(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("interactive fixture reports requested extra hook events before release", () => {
  const root = mkdtempSync(join(tmpdir(), "ticketry-provider-hooks-contract-"));
  try {
    writeFileSync(join(root, "agent-control.json"), JSON.stringify({ mode: "success", autoRelease: true, hooks: ["PermissionRequest", "Notification"] }));
    const result = spawnSync(process.execPath, [new URL("sprint-provider.mjs", import.meta.url).pathname,
      'hooks={command="cat >/dev/null"}',
      `mcp_servers={args=${JSON.stringify(["mcp", "--data-dir", root, "--agent-run-id", "fixture-run"])},command="unused"}`,
    ], { cwd: root, env: { ...process.env, TICKETRY_E2E_PROVIDER_DIR: root }, encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, "fixture-run.hooks.log"), "utf8"), "SessionStart\nUserPromptSubmit\nPermissionRequest\nNotification\nStop\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("interactive fixture makes requested bridge calls while it is still live", async () => {
  const root = mkdtempSync(join(tmpdir(), "ticketry-provider-start-calls-contract-"));
  // A stand-in for the packaged stdio bridge: answer initialize and echo each tool call.
  const bridge = join(root, "bridge.mjs");
  writeFileSync(bridge, `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const result = message.method === "initialize" ? { capabilities: {} } : { structuredContent: { echoed: message.params.name } };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
});`);
  writeFileSync(join(root, "agent-control.json"), JSON.stringify({ mode: "hold", startCalls: [{ name: "mcp_ping", arguments: {} }] }));
  const child = spawn(process.execPath, [new URL("sprint-provider.mjs", import.meta.url).pathname,
    'hooks={command="cat >/dev/null"}',
    `mcp_servers={args=${JSON.stringify([bridge, "mcp", "--data-dir", root, "--agent-run-id", "fixture-run"])},command=${JSON.stringify(process.execPath)}}`,
  ], { cwd: root, env: { ...process.env, TICKETRY_E2E_PROVIDER_DIR: root }, stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once("exit", resolve));
  try {
    const log = join(root, "fixture-run.calls.log");
    for (let attempt = 0; !existsSync(log); attempt++) {
      assert.equal(child.exitCode, null, stderr);
      assert.ok(attempt < 500, "start calls exceeded their bounded deadline");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const [call] = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(call.name, "mcp_ping");
    assert.deepEqual(call.response.result.structuredContent, { echoed: "mcp_ping" });
    // The bridge has disconnected, yet the held provider keeps running.
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(child.exitCode, null, stderr);
  } finally {
    child.kill("SIGKILL");
    await exited;
    rmSync(root, { recursive: true, force: true });
  }
});

test("approved Codex discovery version remains available without fixture state", () => {
  const result = spawnSync(process.execPath, [new URL("sprint-provider.mjs", import.meta.url).pathname, "--version"], {
    env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "codex-cli 0.0.0-ticketry-sprint-e2e");
});

function planningInvocation(control, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "ticketry-planning-provider-contract-"));
  const schema = join(root, "suggestions-schema.json");
  const output = join(root, "suggestions-result.json");
  const id = root.split("/").at(-1);
  writeFileSync(schema, JSON.stringify({ properties: { suggestions: { type: "array" } } }));
  writeFileSync(join(root, "control.json"), JSON.stringify(control));
  writeFileSync(join(root, `${id}.release`), "release");
  const snapshot = {
    project_id: "fixture-project", goals: [{ id: "fixture-goal", text: "Exercise local planning" }],
    epics: [{ id: "fixture-epic", name: "Contract epic" }],
    backlog: [
      { id: "existing-story", name: "Contract existing" },
      { id: "ungrouped-story", name: "Contract ungrouped" },
      { id: "waiting-story", name: "Contract waiting" },
    ],
  };
  // Typed planning must stay credential-free even when the test host is an
  // interactive Ticketry run. Deliberate overrides exercise its refusal.
  const { TICKETRY_MCP_AUTHORIZATION, MUXED_AGENT_RUN_ID, ...environment } = process.env;
  try {
    const result = spawnSync(process.execPath, [new URL("sprint-provider.mjs", import.meta.url).pathname,
      "exec", "--output-schema", schema, "--output-last-message", output,
    ], {
      cwd: root, env: { ...environment, TICKETRY_E2E_PROVIDER_DIR: root, ...overrides },
      input: `Use the supplied planning snapshot.\nPlanning snapshot:\n${JSON.stringify(snapshot)}`,
      encoding: "utf8", timeout: 5000,
    });
    const readIfPresent = path => { try { return JSON.parse(readFileSync(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } };
    return { result, output: readIfPresent(output), startup: readIfPresent(join(root, `${id}.started.json`)) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("typed planning still emits deterministic existing and proposed suggestions", () => {
  const { result, output, startup } = planningInvocation({ kind: "success", prefix: "Contract" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(startup.goalIds, ["fixture-goal"]);
  assert.equal(startup.projectId, "fixture-project");
  assert.deepEqual(output.suggestions.map(row => ({ goal: row.goal_id, story: row.story })), [
    { goal: "fixture-goal", story: { kind: "existing", issue_id: "existing-story" } },
    { goal: "fixture-goal", story: { kind: "existing", issue_id: "ungrouped-story" } },
    { goal: "fixture-goal", story: { kind: "existing", issue_id: "waiting-story" } },
    { goal: "fixture-goal", story: { kind: "proposed", name: "Contract proposal", epic_id: "fixture-epic" } },
  ]);
  assert.ok(output.suggestions.every(row => typeof row.reason === "string" && row.reason.length > 0));
});

test("typed planning refresh, empty output and controlled failure preserve their contract", () => {
  const refreshed = planningInvocation({ kind: "success", prefix: "Contract", refresh: true });
  assert.equal(refreshed.result.status, 0, refreshed.result.stderr);
  assert.deepEqual(refreshed.output.suggestions.map(row => row.story), [
    { kind: "existing", issue_id: "waiting-story" },
    { kind: "proposed", name: "Contract refreshed proposal", epic_id: "fixture-epic" },
  ]);
  const empty = planningInvocation({ kind: "success", empty: true });
  assert.equal(empty.result.status, 0, empty.result.stderr);
  assert.deepEqual(empty.output, { suggestions: [] });
  const failure = planningInvocation({ kind: "failure" });
  assert.equal(failure.result.status, 23, failure.result.stderr);
  assert.equal(failure.output, undefined);
});

test("typed planning refuses interactive credentials before publishing suggestions", () => {
  for (const credentials of [{ TICKETRY_MCP_AUTHORIZATION: "fixture-only-secret" }, { MUXED_AGENT_RUN_ID: "fixture-run" }]) {
    const { result, output, startup } = planningInvocation({ kind: "success", empty: true }, credentials);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Typed execution must not receive interactive agent credentials/);
    assert.equal(output, undefined);
    assert.equal(startup, undefined);
  }
});


test("typed planning waits for explicit release before publishing output", async () => {
  const root = mkdtempSync(join(tmpdir(), "ticketry-planning-release-contract-"));
  const schema = join(root, "schema.json");
  const output = join(root, "result.json");
  const id = root.split("/").at(-1);
  writeFileSync(schema, JSON.stringify({ properties: { suggestions: { type: "array" } } }));
  writeFileSync(join(root, "control.json"), JSON.stringify({ kind: "success", empty: true }));
  const { TICKETRY_MCP_AUTHORIZATION, MUXED_AGENT_RUN_ID, ...environment } = process.env;
  const child = spawn(process.execPath, [new URL("sprint-provider.mjs", import.meta.url).pathname,
    "exec", "--output-schema", schema, "--output-last-message", output,
  ], { cwd: root, env: { ...environment, TICKETRY_E2E_PROVIDER_DIR: root }, stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    child.stdin.end(`Planning snapshot:\n${JSON.stringify({ project_id: "fixture-project", goals: [{ id: "fixture-goal" }] })}`);
    // Startup is the provider's observable acknowledgement of parsed input;
    // polling does not assume how quickly a subprocess becomes ready.
    while (!existsSync(join(root, `${id}.started.json`))) {
      assert.equal(child.exitCode, null, stderr);
      assert.equal(child.signalCode, null, "provider startup exceeded its bounded deadline");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(child.exitCode, null);
    assert.equal(existsSync(output), false, "unreleased planning must not publish output");
    writeFileSync(join(root, `${id}.release`), "release");
    assert.deepEqual(await exited, { code: 0, signal: null }, stderr);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), { suggestions: [] });
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null) { child.kill("SIGKILL"); await exited; }
    rmSync(root, { recursive: true, force: true });
  }
});
