import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export async function withProviderMcp(command, args, body) {
  const bridge = spawn(command, args, { env: process.env, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: bridge.stdout });
  let pending;
  let nextId = 0;
  const fail = error => { pending?.reject(error); pending = undefined; };
  bridge.on("error", fail);
  bridge.on("exit", () => fail(new Error("Fixture MCP bridge exited")));
  lines.on("line", line => {
    try {
      const message = JSON.parse(line);
      if (pending?.id === message.id) { pending.resolve(message); pending = undefined; }
    } catch (error) { fail(error); }
  });
  const send = message => bridge.stdin.write(JSON.stringify(message) + "\n");
  async function request(method, params) {
    const id = ++nextId;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        timer = setTimeout(() => fail(new Error("Fixture MCP request timed out")), 10000);
        send({ jsonrpc: "2.0", id, method, params });
      });
    } finally { clearTimeout(timer); }
  }
  try {
    const initialized = await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "browser-fixture", version: "1" } });
    if (!initialized.result) throw new Error("Fixture MCP initialization failed");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    await body(request);
  } finally {
    bridge.stdin.end();
    lines.close();
    bridge.kill();
  }
}
