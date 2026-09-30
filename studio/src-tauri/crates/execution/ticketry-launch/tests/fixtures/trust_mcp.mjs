import { createInterface } from "node:readline";

// No network or provider authentication: only the directory-trust MCP startup gate.
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  const result = request.method === "initialize"
    ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "trust-probe", version: "1" } }
    : request.method === "tools/list" ? { tools: [] } : {};
  console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
}
