import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const defaultFrontendPort = 5174;
const frontendPortCandidates = 10;
const defaultBackendPort = 8787;
const defaultMcpPort = 8123;
const servicePortCandidates = 10;
const connectMode = "connect";
const isolatedMode = "isolated";

function sanitizedBasename(worktreeRoot) {
  return path.basename(worktreeRoot)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "worktree";
}

export function resolveDevelopmentDataDirectory({
  cwd = studioRoot,
  environment = process.env,
} = {}) {
  if (environment.MUXED_DATA_DIR) return environment.MUXED_DATA_DIR;

  let worktreeRoot;
  try {
    const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    worktreeRoot = realpathSync(gitRoot);
  } catch (error) {
    throw new Error(
      `could not resolve a Git worktree for desktop:dev launched from ${cwd}: ${error.message}`,
    );
  }

  if (!environment.HOME) {
    throw new Error("could not determine HOME for the development data directory");
  }
  const identity = createHash("sha256").update(worktreeRoot).digest("hex").slice(0, 16);
  return path.join(
    environment.HOME,
    ".config",
    "worktracker-studio-development",
    `${sanitizedBasename(worktreeRoot)}-${identity}`,
  );
}

export function resolveDevelopmentTmuxSocket(dataDirectory) {
  const identity = createHash("sha256")
    .update(path.resolve(dataDirectory))
    .digest("hex")
    .slice(0, 16);
  return `muxed-dev-${identity}`;
}

function parseFrontendPort(value) {
  if (!/^\d+$/.test(value ?? "") || Number(value) < 1 || Number(value) > 65_535) {
    throw new Error("MUXED_FRONTEND_PORT must be a valid TCP port (1-65535)");
  }
  return Number(value);
}

function canListen(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
      } else {
        reject(error);
      }
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

export async function selectFrontendPort({
  requestedPort,
  isAvailable = canListen,
} = {}) {
  if (requestedPort !== undefined) {
    const port = parseFrontendPort(String(requestedPort));
    if (!await isAvailable(port)) {
      throw new Error(
        `Requested frontend port ${port} is unavailable; choose a free MUXED_FRONTEND_PORT or stop the process using it`,
      );
    }
    return port;
  }

  for (let offset = 0; offset < frontendPortCandidates; offset += 1) {
    const port = defaultFrontendPort + offset;
    if (await isAvailable(port)) return port;
  }
  throw new Error(
    `No frontend port is available in ${defaultFrontendPort}-${defaultFrontendPort + frontendPortCandidates - 1}; free one of those ports or set MUXED_FRONTEND_PORT`,
  );
}

async function selectServicePort({
  name,
  requestedPort,
  firstPort,
  excluded = [],
  isAvailable = canListen,
}) {
  if (requestedPort !== undefined) {
    const port = parsePort(name, String(requestedPort));
    if (excluded.includes(port) || !await isAvailable(port)) {
      throw new Error(`Requested ${name} port ${port} is unavailable`);
    }
    return port;
  }
  for (let offset = 0; offset < servicePortCandidates; offset += 1) {
    const port = firstPort + offset;
    if (!excluded.includes(port) && await isAvailable(port)) return port;
  }
  throw new Error(
    `No ${name} port is available in ${firstPort}-${firstPort + servicePortCandidates - 1}`,
  );
}

function parsePort(name, value) {
  if (!/^\d+$/.test(value ?? "") || Number(value) < 1 || Number(value) > 65_535) {
    throw new Error(`${name} port must be a valid TCP port (1-65535)`);
  }
  return Number(value);
}

export function parseDesktopDevMode(args = []) {
  if (args.length === 0) return isolatedMode;
  if (
    (args.length === 1 && args[0] === "--connect") ||
    (args.length === 2 && args[0] === "--" && args[1] === "--connect")
  ) {
    return connectMode;
  }
  throw new Error(
    "usage: pnpm --filter @worktracker/studio desktop:dev -- --connect",
  );
}

export async function selectDevelopmentServicePorts({
  environment = process.env,
  isAvailable = canListen,
} = {}) {
  const backend = await selectServicePort({
    name: "backend",
    requestedPort: environment.MUXED_DESKTOP_BACKEND_PORT,
    firstPort: defaultBackendPort,
    isAvailable,
  });
  const mcp = await selectServicePort({
    name: "MCP",
    requestedPort: environment.MUXED_DESKTOP_MCP_PORT,
    firstPort: defaultMcpPort,
    excluded: [backend],
    isAvailable,
  });
  return { backend, mcp };
}

export function buildTauriDevelopmentConfig(port) {
  const origin = `http://127.0.0.1:${port}`;
  return {
    build: {
      beforeDevCommand: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
      devUrl: origin,
    },
  };
}

export function buildConnectLaunch({ environment = process.env } = {}) {
  const dataDirectory = environment.MUXED_DATA_DIR ||
    (environment.HOME
      ? path.join(environment.HOME, ".config", "worktracker-studio")
      : null);
  if (!dataDirectory) {
    throw new Error("could not determine HOME for the established data directory");
  }

  const frontendOrigin = `http://127.0.0.1:${defaultFrontendPort}`;
  const frontendWebSocketOrigin = `ws://127.0.0.1:${defaultFrontendPort}`;
  return {
    backendPort: defaultBackendPort,
    dataDirectory,
    frontendOrigin,
    config: {
      build: {
        beforeDevCommand: null,
        devUrl: frontendOrigin,
      },
    },
    environment: {
      ...environment,
      MUXED_DATA_DIR: dataDirectory,
      MUXED_DESKTOP_DEVELOPMENT_MODE: connectMode,
      MUXED_DESKTOP_ORIGIN: frontendOrigin,
      MUXED_DESKTOP_BACKEND_PORT: String(defaultBackendPort),
      MUXED_DESKTOP_WORKTRACKER_API: `${frontendOrigin}/api/work-tracker`,
      MUXED_DESKTOP_AGENT_API: `${frontendOrigin}/api`,
      MUXED_DESKTOP_STATUS_API: `${frontendOrigin}/api`,
      MUXED_DESKTOP_STATUS_WEBSOCKET: `${frontendWebSocketOrigin}/ws/status`,
      MUXED_DESKTOP_TERMINAL_WEBSOCKET: `${frontendWebSocketOrigin}/ws/terminal`,
    },
  };
}

export function formatDevelopmentIdentity({
  frontendOrigin,
  backendPort,
  mcpPort,
  dataDirectory,
  tmuxSocket,
}) {
  return [
    "Ticketry desktop development instance:",
    `frontend=${frontendOrigin}`,
    `backend=http://127.0.0.1:${backendPort}`,
    `mcp=http://127.0.0.1:${mcpPort}/mcp`,
    `data=${dataDirectory}`,
    `tmux=${tmuxSocket}`,
  ].join(" ");
}

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: studioRoot,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

export function resolveTauriCliPath(resolver = require.resolve) {
  return resolver("@tauri-apps/cli/tauri.js");
}

export async function main() {
  const mode = parseDesktopDevMode(process.argv.slice(2));
  if (mode === connectMode) {
    const launch = buildConnectLaunch();
    console.log(
      [
        "Ticketry desktop development connection:",
        `frontend=${launch.frontendOrigin}`,
        `backend=http://127.0.0.1:${launch.backendPort}`,
        `data=${launch.dataDirectory}`,
      ].join(" "),
    );
    await run(process.execPath, [
      resolveTauriCliPath(),
      "dev",
      "--no-watch",
      "--features",
      "native-libghostty",
      "--config",
      JSON.stringify(launch.config),
    ], launch.environment);
    return;
  }

  const dataDirectory = resolveDevelopmentDataDirectory();
  const tmuxSocket = resolveDevelopmentTmuxSocket(dataDirectory);
  const frontendPort = await selectFrontendPort({
    requestedPort: process.env.MUXED_FRONTEND_PORT,
  });
  const { backend: backendPort, mcp: mcpPort } = await selectDevelopmentServicePorts();
  const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
  const environment = {
    ...process.env,
    MUXED_DATA_DIR: dataDirectory,
    MUXED_TMUX_SOCKET: tmuxSocket,
    MUXED_DESKTOP_ORIGIN: frontendOrigin,
    MUXED_DESKTOP_BACKEND_PORT: String(backendPort),
    MUXED_DESKTOP_MCP_PORT: String(mcpPort),
    MUXED_VITE_BACKEND_ORIGIN: `http://127.0.0.1:${backendPort}`,
  };
  await run(
    "bash",
    [path.join(studioRoot, "..", "backend", "packaging", "build-sidecar.sh")],
    environment,
  );
  const config = JSON.stringify(buildTauriDevelopmentConfig(frontendPort));
  console.log(formatDevelopmentIdentity({
    frontendOrigin,
    backendPort,
    mcpPort,
    dataDirectory,
    tmuxSocket,
  }));
  await run(process.execPath, [
    resolveTauriCliPath(),
    "dev",
    "--no-watch",
    "--features",
    "native-libghostty",
    "--config",
    config,
  ], environment);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Desktop development launch failed: ${error.message}`);
    process.exitCode = 1;
  });
}
