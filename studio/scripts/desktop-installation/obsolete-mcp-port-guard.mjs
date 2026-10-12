import net from "node:net";

/**
 * Holds the retired MCP TCP ports (8123–8132) from before desktop startup so a
 * regression that binds one fails loudly instead of silently sharing a port.
 * Ticketry's MCP listens only on `<data-directory>/mcp.sock`.
 */
const obsoleteMcpPorts = Array.from({ length: 10 }, (_, index) => 8123 + index);

async function occupyPort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, resolve);
  });
  return server;
}

async function portIsOccupied(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
}

export async function guardObsoleteMcpPorts() {
  const blockers = [];
  for (const port of obsoleteMcpPorts) {
    try {
      blockers.push(await occupyPort(port));
    } catch (error) {
      if (error?.code !== "EADDRINUSE") {
        await Promise.all(blockers.map((server) => closeServer(server).catch(() => {})));
        throw error;
      }
    }
  }
  return {
    async verifyStillOccupied() {
      for (const port of obsoleteMcpPorts) {
        if (!await portIsOccupied(port)) {
          throw new Error(`Port ${port} stopped being occupied during desktop startup`);
        }
      }
    },
    async release() {
      await Promise.all(blockers.map((server) => closeServer(server).catch(() => {})));
    },
  };
}
