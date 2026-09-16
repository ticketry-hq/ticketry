import assert from "node:assert/strict";
import test from "node:test";
import { parseProviderLaunch } from "./desktop-acceptance-provider.mjs";

test("acceptance provider reads the packaged stdio launch with escaped paths and secret environment", () => {
  const config = 'mcp_servers={ticketry={args=["mcp","--data-dir","/tmp/Ticketry \\"Data\\"","--agent-run-id","run-1"],command="/tmp/App Space/ticketry-hook",env_vars=["TICKETRY_MCP_AUTHORIZATION"]}}';
  const launch = parseProviderLaunch([config], { TICKETRY_MCP_AUTHORIZATION: "Bearer secret" });
  assert.deepEqual(launch, {
    command: "/tmp/App Space/ticketry-hook",
    args: ["mcp", "--data-dir", '/tmp/Ticketry "Data"', "--agent-run-id", "run-1"],
    authorization: "Bearer secret",
  });
  assert.throws(() => parseProviderLaunch([config], {}), /authorization/);
  assert.throws(() => parseProviderLaunch(['mcp_servers={ticketry={url="http://localhost"}}'], {}), /stdio/);
});

test("acceptance provider keeps one bridge through both outages before moving workflow states", async () => {
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = mkdtempSync(path.join(tmpdir(), "ticketry-provider-"));
  try {
    const bridgePath = path.join(root, "bridge.mjs");
    writeFileSync(bridgePath, `
      import { createInterface } from 'node:readline';
      import { appendFileSync } from 'node:fs';
      let lists = 0;
      createInterface({ input: process.stdin }).on('line', line => {
        const message = JSON.parse(line);
        appendFileSync(${JSON.stringify(path.join(root, "frames.jsonl"))}, line + '\\n');
        if (message.params?.name === 'list_tasks' && ++lists % 2 === 1) {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32001, data: { reason: 'service_unavailable' } } }));
          return;
        }
        if (message.id) console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id,
          result: message.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {} } : { structuredContent: { ok: true } } }));
      });
    `);
    for (const signal of ["outage-orderly", "reconnected-orderly", "outage-sigkill", "reconnected-sigkill", "advance-Implement", "advance-Review", "advance-Done", "provider-exit"]) {
      writeFileSync(path.join(root, signal), "");
    }
    const args = [bridgePath, "--data-dir", root, "--agent-run-id", "run-1"];
    const config = `mcp_servers={ticketry={args=${JSON.stringify(args)},command=${JSON.stringify(process.execPath)},env_vars=["TICKETRY_MCP_AUTHORIZATION"]}}`;
    const child = spawn(process.execPath, [fileURLToPath(new URL("./desktop-acceptance-provider.mjs", import.meta.url)), root,
      config, 'hooks={command="cat >/dev/null"}', 'Project ID: project-1\nWork Item ID: task-1'], {
      cwd: root, env: { ...process.env, TICKETRY_MCP_AUTHORIZATION: "Bearer fixture-secret" }, stdio: "pipe",
    });
    let stderr = "";
    child.stderr.on("data", data => { stderr += data; });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error("Provider fixture timed out")); }, 5_000);
      child.on("error", reject);
      child.on("exit", code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(stderr)); });
    });
    const frames = readFileSync(path.join(root, "frames.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(frames.map(frame => frame.method), ["initialize", "notifications/initialized", ...Array(7).fill("tools/call")]);
    assert.deepEqual(frames.slice(6).map(frame => frame.params.arguments.status_name), ["Implement", "Review", "Done"]);
    assert.equal(JSON.parse(readFileSync(path.join(root, "provider-started.json"), "utf8")).mcp_data_directory, root);
    const started = JSON.parse(readFileSync(path.join(root, "provider-started.json"), "utf8"));
    assert.equal(started.agent_run_id, "run-1");
    assert.ok(started.bridge_pid > 0);
    for (const mode of ["orderly", "sigkill"]) {
      const recovered = JSON.parse(readFileSync(path.join(root, `recovery-${mode}.json`), "utf8"));
      assert.deepEqual(recovered.identity, started);
      assert.equal(recovered.outage.error.code, -32001);
      assert.ok(recovered.outage_ms < 1000);
    }
    assert.equal(readFileSync(path.join(root, "provider-hooks.log"), "utf8"), "SessionStart\nUserPromptSubmit\nPostToolUse\nPostToolUse\nPostToolUse\nStop\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
