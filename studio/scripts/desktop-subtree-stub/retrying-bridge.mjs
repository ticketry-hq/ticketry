import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const REQUEST_TIMEOUT_MILLIS = 10_000;
const RETRY_INTERVAL_MILLIS = 250;

/**
 * A JSON-RPC client over the packaged stdio MCP bridge that keeps retrying
 * until a bounded deadline. While Ticketry is down the bridge answers with an
 * error; once Ticketry restarts the same bridge reconnects. If the bridge
 * process itself ends, a fresh one is spawned from the same launch arguments.
 *
 * `record` receives every response and transport failure, attempts included.
 */
export function openRetryingBridge({ command, args, clientName, record = () => {} }) {
  let connection;
  const pids = [];

  function connect() {
    const child = spawn(command, args, { env: process.env, stdio: ["pipe", "pipe", "inherit"] });
    const lines = createInterface({ input: child.stdout });
    const state = { child, lines, pending: undefined, nextId: 0, alive: true, initialized: false };
    const fail = (error) => { state.pending?.reject(error); state.pending = undefined; };
    child.on("error", (error) => { state.alive = false; fail(error); });
    child.on("exit", () => { state.alive = false; fail(new Error("MCP bridge exited")); });
    lines.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch (error) { fail(error); return; }
      if (state.pending && message.id === state.pending.id) {
        state.pending.resolve(message);
        state.pending = undefined;
      }
    });
    state.send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    state.request = async (method, params) => {
      const id = ++state.nextId;
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          state.pending = { id, resolve, reject };
          timer = setTimeout(() => fail(new Error("MCP request timed out")), REQUEST_TIMEOUT_MILLIS);
          state.send({ jsonrpc: "2.0", id, method, params });
        });
      } finally { clearTimeout(timer); }
    };
    pids.push(child.pid);
    return state;
  }

  function close(state) {
    if (!state) return;
    state.child.stdin.end();
    state.lines.close();
    state.child.kill();
  }

  async function initialized() {
    if (connection && !connection.alive) { close(connection); connection = undefined; }
    connection ??= connect();
    if (!connection.initialized) {
      const response = await connection.request("initialize", {
        protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: clientName, version: "1" },
      });
      record({ method: "initialize", bridge_pid: connection.child.pid, response });
      if (!response.result) throw new Error("MCP initialization failed");
      connection.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      connection.initialized = true;
    }
    return connection;
  }

  // Retries JSON-RPC errors and transport failures; a result, even a refused
  // tool result, is final and returned to the caller.
  async function call(method, params, { retryMillis }) {
    const deadline = Date.now() + retryMillis;
    for (let attempt = 1; ; attempt++) {
      let failure;
      try {
        const current = await initialized();
        const response = await current.request(method, params);
        record({ method, attempt, bridge_pid: current.child.pid, response });
        if (!response.error) return response;
        failure = new Error(`MCP ${method} answered ${JSON.stringify(response.error)}`);
      } catch (error) {
        record({ method, attempt, bridge_pid: connection?.child.pid, transport_error: error.message });
        failure = error;
      }
      if (Date.now() + RETRY_INTERVAL_MILLIS > deadline) {
        throw new Error(`MCP ${method} did not succeed within ${retryMillis}ms: ${failure.message}`);
      }
      await delay(RETRY_INTERVAL_MILLIS);
    }
  }

  return {
    // Connects eagerly so the start record can name the bridge process.
    async connect({ retryMillis }) {
      const deadline = Date.now() + retryMillis;
      for (;;) {
        try { return (await initialized()).child.pid; } catch (error) {
          if (Date.now() + RETRY_INTERVAL_MILLIS > deadline) throw error;
          await delay(RETRY_INTERVAL_MILLIS);
        }
      }
    },
    callTool: (name, args, options) => call("tools/call", { name, arguments: args }, options),
    get pid() { return connection?.child.pid; },
    get pids() { return [...pids]; },
    close() { close(connection); connection = undefined; },
  };
}
