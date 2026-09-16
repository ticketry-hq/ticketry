import http from "node:http";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";

const name = process.env.MUXED_SMOKE_FIXTURE_NAME;
const dataDirectory = process.env.MUXED_DATA_DIR;
if (!name || !dataDirectory) throw new Error("fixture identity is required");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const frontend = await listen((_request, response) => response.end(name));
const frontendOrigin = `http://127.0.0.1:${frontend.address().port}`;
const backend = await listen((request, response) => {
  if (request.headers.origin !== frontendOrigin) {
    response.writeHead(403).end();
    return;
  }
  response.end(name);
});
const socketPath = path.join(dataDirectory, "mcp.sock");
const mcp = net.createServer((socket) => {
  readline.createInterface({ input: socket }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.ticketry_mcp_auth) {
      socket.write(`${JSON.stringify({ ticketry_mcp_auth: 1, ok: true })}\n`);
    } else if (message.id !== undefined) {
      const result = message.method === "initialize"
        ? { protocolVersion: "2024-11-05", capabilities: {} }
        : { structuredContent: { owner: name } };
      socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
    }
  });
});
await new Promise((resolve, reject) => {
  mcp.once("error", reject);
  mcp.listen(socketPath, resolve);
});

console.log(`MUXED_DEVELOPMENT_IDENTITY ${JSON.stringify({
  frontend: frontendOrigin,
  backend: `http://127.0.0.1:${backend.address().port}`,
  mcp: socketPath,
  dataDirectory,
})}`);

const shutdown = () => Promise.all([frontend, backend, mcp].map(
  (server) => new Promise((resolve) => server.close(resolve)),
)).then(() => process.exit(0));
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
