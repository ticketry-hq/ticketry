import path from "node:path";

import { callSocketMcpTool } from "../mcp-socket-client.mjs";

/** Waits until this installation's MCP socket answers a ping and lists projects. */
export async function waitForMcpPing(dataDirectory, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Ticketry exited before its MCP listener became ready (${child.exitCode})`);
    }
    try {
      const result = await callSocketMcpTool(dataDirectory, "mcp_ping", {}, 1_000);
      if (result.structuredContent?.status === "ok"
          && result.structuredContent.server === "ticketry") {
        const projects = await callSocketMcpTool(dataDirectory, "list_projects", {}, 1_000);
        if (!projects.isError && Array.isArray(projects.structuredContent?.result)) return;
      }
    } catch {
      // WebDriver can start before MCP reconciliation finishes.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Ticketry MCP did not answer through ${path.join(dataDirectory, "mcp.sock")}`);
}
