import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Parse the generated Codex inline table, whose strings/arrays use JSON escaping.
export function parseProviderLaunch(argv, environment) {
  const config = argv.find((value) => value.startsWith("mcp_servers=")) ?? "";
  const command = config.match(/command=("(?:[^"\\]|\\.)*")/);
  const args = config.match(/args=(\[.*?\]),command=/);
  if (!command || !args || !config.includes('env_vars=["TICKETRY_MCP_AUTHORIZATION"]')) {
    throw new Error("Acceptance provider requires the packaged stdio MCP configuration");
  }
  if (!environment.TICKETRY_MCP_AUTHORIZATION) throw new Error("Missing MCP authorization");
  return { command: JSON.parse(command[1]), args: JSON.parse(args[1]), authorization: environment.TICKETRY_MCP_AUTHORIZATION };
}

export async function runProvider(root, argv) {
  if (argv[0] === "--version") {
    console.log("codex-cli 0.0.0-ticketry-acceptance");
    return;
  }
  const launch = parseProviderLaunch(argv, process.env);
  const hooks = argv.find((value) => value.startsWith("hooks=")) ?? "";
  const hookMatch = hooks.match(/command=("(?:[^"\\]|\\.)*")/);
  if (!hookMatch) throw new Error("Missing lifecycle hook command");
  const hookCommand = JSON.parse(hookMatch[1]);
  const prompt = argv.at(-1) ?? "";
  const fallback = existsSync(path.join(root, "provider-task"))
    ? readFileSync(path.join(root, "provider-task"), "utf8").split("\n") : [];
  const taskId = prompt.match(/^Work Item ID: (.+)$/m)?.[1] ?? fallback[0];
  const projectId = prompt.match(/^Project ID: (.+)$/m)?.[1] ?? fallback[1];
  if (!taskId || !projectId) throw new Error("Missing provider work item identity");
  const bridge = spawn(launch.command, launch.args, { env: process.env, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: bridge.stdout });
  let pending;
  let nextId = 0;
  function fail(error) { pending?.reject(error); pending = undefined; }
  bridge.on("error", fail);
  bridge.on("exit", () => fail(new Error("MCP bridge exited")));
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (pending && message.id === pending.id) {
        pending.resolve(message);
        pending = undefined;
      }
    } catch (error) { fail(error); }
  });
  function send(message) { bridge.stdin.write(`${JSON.stringify(message)}\n`); }
  async function request(method, params) {
    const id = ++nextId;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        timer = setTimeout(() => fail(new Error("MCP request timed out")), 10_000);
        send({ jsonrpc: "2.0", id, method, params });
      });
    } finally { clearTimeout(timer); }
  }
  function emitHook(event) {
    const result = spawnSync("/bin/sh", ["-c", hookCommand], {
      input: JSON.stringify({ hook_event_name: event, session_id: "ticketry-acceptance-provider" }),
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error("Provider lifecycle hook failed");
    appendFileSync(path.join(root, "provider-hooks.log"), `${event}\n`);
  }
  async function waitForSignal(signal) {
    for (let attempt = 0; attempt < 240; attempt++) {
      if (existsSync(path.join(root, signal))) return;
      await delay(250);
    }
    throw new Error(`Timed out waiting for ${signal}`);
  }
  try {
    const initialized = await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "desktop-acceptance", version: "1" } });
    if (!initialized.result) throw new Error("MCP initialization failed");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const identity = {
      pid: process.pid, bridge_pid: bridge.pid,
      agent_run_id: launch.args[launch.args.indexOf("--agent-run-id") + 1],
      provider_session_id: "ticketry-acceptance-provider", cwd: process.cwd(), task_id: taskId, project_id: projectId,
      hook: true, mcp_data_directory: launch.args[launch.args.indexOf("--data-dir") + 1], mcp_authorization: true,
    };
    writeFileSync(path.join(root, "provider-started.json"), JSON.stringify(identity));
    console.log("Ticketry desktop acceptance provider started");
    emitHook("SessionStart");
    emitHook("UserPromptSubmit");
    for (const mode of ["orderly", "sigkill"]) {
      await waitForSignal(`outage-${mode}`);
      const started = performance.now();
      const outage = await request("tools/call", { name: "list_tasks", arguments: { project_id: projectId } });
      const outageMs = performance.now() - started;
      if (outage.error?.code !== -32001 || outageMs >= 1000) {
        throw new Error(`Expected correlated outage error within one second after ${mode}`);
      }
      writeFileSync(path.join(root, `outage-observed-${mode}`), "");
      await waitForSignal(`reconnected-${mode}`);
      let recovered;
      for (let attempt = 0; attempt < 30; attempt++) {
        recovered = await request("tools/call", { name: "list_tasks", arguments: { project_id: projectId } });
        if (!recovered.error) break;
        await delay(100);
      }
      if (!recovered.result || recovered.result.isError) throw new Error(`MCP did not recover after ${mode}`);
      writeFileSync(path.join(root, `recovery-${mode}.json`), JSON.stringify({ identity, outage, outage_ms: outageMs, recovered }));
    }
    for (const state of ["Implement", "Review", "Done"]) {
      await waitForSignal(`advance-${state}`);
      const response = await request("tools/call", { name: "update_task_status", arguments: { project_id: projectId, task_id: taskId, status_name: state } });
      const serialized = JSON.stringify(response);
      appendFileSync(path.join(root, "provider-mcp.log"), `${serialized}\n`);
      if (!serialized.includes('"ok":true')) throw new Error(`Ticketry MCP refused state ${state}`);
      emitHook("PostToolUse");
    }
    await waitForSignal("provider-exit");
    emitHook("Stop");
    console.log("Ticketry desktop acceptance provider completed");
  } finally {
    bridge.stdin.end();
    lines.close();
    bridge.kill();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  runProvider(root, process.argv.slice(3)).catch((error) => {
    writeFileSync(path.join(root, "provider-error.log"), error.message);
    console.error(error.message);
    process.exitCode = 1;
  });
}
