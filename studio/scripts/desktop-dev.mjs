import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
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
const temporarySqlitePrefix = "ticketry-temp-sqlite-";

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

export function parseDesktopDevOptions(args = []) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized.length === 0) {
    return { mode: isolatedMode, temporarySqlite: false };
  }
  if (normalized.length === 1 && normalized[0] === "--connect") {
    return { mode: connectMode, temporarySqlite: false };
  }
  if (normalized.length === 1 && normalized[0] === "--temp-sqlite") {
    return { mode: isolatedMode, temporarySqlite: true };
  }
  throw new Error(
    "usage: pnpm --filter @worktracker/studio desktop:dev -- [--connect | --temp-sqlite]",
  );
}

export function parseDesktopDevMode(args = []) {
  return parseDesktopDevOptions(args).mode;
}

export function createTemporarySqliteProfile({ temporaryRoot = tmpdir() } = {}) {
  return mkdtempSync(path.join(temporaryRoot, temporarySqlitePrefix));
}

export function removeTemporarySqliteProfile(
  dataDirectory,
  { temporaryRoot = tmpdir() } = {},
) {
  const resolvedRoot = realpathSync(temporaryRoot);
  const resolvedDirectory = realpathSync(dataDirectory);
  if (
    path.dirname(resolvedDirectory) !== resolvedRoot ||
    !path.basename(resolvedDirectory).startsWith(temporarySqlitePrefix)
  ) {
    throw new Error(`refusing to remove non-temporary Ticketry profile: ${dataDirectory}`);
  }
  rmSync(resolvedDirectory, { recursive: true, force: true });
}

export function stopTemporaryTmuxServer(
  tmuxSocket,
  { runner = execFileSync } = {},
) {
  try {
    runner("tmux", ["-L", tmuxSocket, "kill-server"], { stdio: "ignore" });
  } catch (error) {
    // tmux exits nonzero when no session ever started in this temporary run.
    if (error?.status !== 1) {
      console.warn(`Could not stop temporary tmux server ${tmuxSocket}: ${error.message}`);
    }
  }
}

export async function selectDevelopmentServicePorts({
  environment = process.env,
  isAvailable = canListen,
  temporarySqlite = false,
} = {}) {
  const backend = await selectServicePort({
    name: "backend",
    requestedPort: environment.MUXED_DESKTOP_BACKEND_PORT,
    firstPort: defaultBackendPort,
    isAvailable,
  });
  if (temporarySqlite) {
    // The desktop supervisor treats MCP as optional. Let it make exactly one
    // attempt on the public endpoint; an occupied 8123 keeps the backend usable.
    return { backend, mcp: defaultMcpPort };
  }
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
      MUXED_DESKTOP_CHAT_WEBSOCKET: `${frontendWebSocketOrigin}/ws/chat`,
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
    // Keeping handlers installed makes the launcher wait for the child to
    // finish its own shutdown before the temporary profile is removed. Signals
    // sent only to this Node process are forwarded explicitly; terminal process
    // groups may also deliver the same signal directly to the child.
    const forwardSigint = () => child.kill("SIGINT");
    const forwardSigterm = () => child.kill("SIGTERM");
    const removeSignalHandlers = () => {
      process.off("SIGINT", forwardSigint);
      process.off("SIGTERM", forwardSigterm);
    };
    process.once("SIGINT", forwardSigint);
    process.once("SIGTERM", forwardSigterm);
    child.once("error", (error) => {
      removeSignalHandlers();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      removeSignalHandlers();
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

export function resolveTauriCliPath(resolver = require.resolve) {
  return resolver("@tauri-apps/cli/tauri.js");
}

export function findRunningInstalledTicketry({
  platform = process.platform,
  runner = execFileSync,
} = {}) {
  if (platform !== "darwin") return [];

  const processTable = runner("ps", ["-axo", "pid=,comm="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return processTable
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(.+?)\s*$/))
    .filter((match) =>
      match?.[2].endsWith("/Ticketry.app/Contents/MacOS/ticketry")
    )
    .map((match) => ({ pid: Number(match[1]), executable: match[2] }));
}

export function assertInstalledTicketryIsNotRunning(options) {
  const running = findRunningInstalledTicketry(options);
  if (running.length === 0) return;

  const processes = running
    .map(({ pid, executable }) => `${executable} (PID ${pid})`)
    .join(", ");
  throw new Error(
    `the installed Ticketry app is still running: ${processes}. ` +
    "Quit it with Command-Q; closing its window is not enough. Then rerun pnpm run dev",
  );
}

export async function main() {
  assertInstalledTicketryIsNotRunning();
  const options = parseDesktopDevOptions(process.argv.slice(2));
  if (options.mode === connectMode) {
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

  const frontendPort = await selectFrontendPort({
    requestedPort: process.env.MUXED_FRONTEND_PORT,
  });
  const { backend: backendPort, mcp: mcpPort } = await selectDevelopmentServicePorts({
    temporarySqlite: options.temporarySqlite,
  });
  const dataDirectory = options.temporarySqlite
    ? createTemporarySqliteProfile()
    : resolveDevelopmentDataDirectory();
  const tmuxSocket = resolveDevelopmentTmuxSocket(dataDirectory);
  const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
  const environment = {
    ...process.env,
    MUXED_DATA_DIR: dataDirectory,
    MUXED_ENABLE_LOCAL_POSTGRES: "true",
    MUXED_TMUX_SOCKET: tmuxSocket,
    MUXED_DESKTOP_ORIGIN: frontendOrigin,
    MUXED_DESKTOP_BACKEND_PORT: String(backendPort),
    MUXED_DESKTOP_MCP_PORT: String(mcpPort),
    MUXED_VITE_BACKEND_ORIGIN: `http://127.0.0.1:${backendPort}`,
  };
  if (options.temporarySqlite) {
    environment.MUXED_FORCE_SQLITE = "true";
  }
  try {
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
  } finally {
    if (options.temporarySqlite) {
      stopTemporaryTmuxServer(tmuxSocket);
      removeTemporarySqliteProfile(dataDirectory);
      console.log(`Removed temporary SQLite profile: ${dataDirectory}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Desktop development launch failed: ${error.message}`);
    process.exitCode = 1;
  });
}
