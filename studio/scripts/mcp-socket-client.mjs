import net from "node:net";
import path from "node:path";

// Test tooling only: one explicit global connection per call, with no discovery or retries.
export function callSocketMcpTool(dataDirectory, name, arguments_ = {}, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path.join(dataDirectory, "mcp.sock"));
    let buffer = "";
    let authenticated = false;
    const send = (message) => socket.write(`${JSON.stringify(message)}\n`);
    const finish = (error, result) => {
      clearTimeout(timeout);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const timeout = setTimeout(() => finish(new Error("MCP socket call timed out")), timeoutMs);
    socket.on("error", (error) => finish(error));
    socket.on("end", () => finish(new Error("MCP socket closed before replying")));
    socket.on("connect", () => send({ ticketry_mcp_auth: 1, mode: "global" }));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (!authenticated) {
            if (message.ticketry_mcp_auth !== 1 || message.ok !== true) {
              throw new Error("MCP socket rejected global authentication");
            }
            authenticated = true;
            send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
              protocolVersion: "2024-11-05", capabilities: {},
              clientInfo: { name: "ticketry-acceptance", version: "1" },
            } });
          } else if (message.id === 1) {
            if (message.error || !message.result) throw new Error("MCP initialization failed");
            send({ jsonrpc: "2.0", method: "notifications/initialized" });
            send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: arguments_ } });
          } else if (message.id === 2) {
            if (message.error) throw new Error(message.error.message ?? "MCP call failed");
            finish(null, message.result);
          }
        } catch (error) {
          finish(error);
          return;
        }
      }
    });
    socket.setEncoding("utf8");
  });
}
