import http from "node:http";

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
const mcp = await listen((_request, response) => response.end(name));

console.log(`MUXED_DEVELOPMENT_IDENTITY ${JSON.stringify({
  frontend: frontendOrigin,
  backend: `http://127.0.0.1:${backend.address().port}`,
  mcp: `http://127.0.0.1:${mcp.address().port}`,
  dataDirectory,
})}`);

const shutdown = () => Promise.all([frontend, backend, mcp].map(
  (server) => new Promise((resolve) => server.close(resolve)),
)).then(() => process.exit(0));
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
