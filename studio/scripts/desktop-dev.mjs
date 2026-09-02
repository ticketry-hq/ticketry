import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  productIdentity,
  resolveProductDataDirectory,
} from "../../scripts/product-identity.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const defaultFrontendPort = 5174;
const frontendPortCandidates = 10;
const isolatedMode = "isolated";
const productionDataMode = "production-data";
const productionTmuxSocket = "muxed";
const temporarySqlitePrefix = "ticketry-temp-sqlite-";
const workspaceRoot = path.resolve(studioRoot, "..");

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
    `${productIdentity.defaultDataDirectoryName}-development`,
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

export function resolveDevelopmentLogPath({ root = workspaceRoot } = {}) {
  return path.join(path.resolve(root), ".ticketry-dev", "logs", "ticketry.log");
}

export function prepareDevelopmentLog({ root = workspaceRoot } = {}) {
  const logPath = resolveDevelopmentLogPath({ root });
  mkdirSync(path.dirname(logPath), { recursive: true });
  return logPath;
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

export function parseDesktopDevOptions(args = []) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized.length === 0) {
    return { mode: isolatedMode, temporarySqlite: false };
  }
  if (normalized.length === 1 && normalized[0] === "--temp-sqlite") {
    return { mode: isolatedMode, temporarySqlite: true };
  }
  if (normalized.length === 1 && normalized[0] === "--production-data") {
    return { mode: productionDataMode, temporarySqlite: false };
  }
  throw new Error(
    "usage: pnpm --filter @worktracker/studio desktop:dev -- [--production-data | --temp-sqlite]",
  );
}

export function parseDesktopDevMode(args = []) {
  return parseDesktopDevOptions(args).mode;
}

export function resolveDesktopDevelopmentProfile({
  options,
  cwd = workspaceRoot,
  environment = process.env,
  temporaryRoot = tmpdir(),
  resolveProductData = resolveProductDataDirectory,
  resolveDevelopmentData = resolveDevelopmentDataDirectory,
} = {}) {
  const dataDirectory = options.temporarySqlite
    ? createTemporarySqliteProfile({ temporaryRoot })
    : options.mode === productionDataMode
      ? resolveProductData({ cwd, environment })
      : resolveDevelopmentData({ cwd, environment });
  const tmuxSocket = options.mode === productionDataMode
    ? environment.MUXED_TMUX_SOCKET ?? productionTmuxSocket
    : resolveDevelopmentTmuxSocket(dataDirectory);
  return { dataDirectory, tmuxSocket };
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

export function buildTauriDevelopmentConfig(port) {
  const origin = `http://127.0.0.1:${port}`;
  // CODIN-1514 diagnostic hook. ghostty-wasm needs no flag because it is the
  // default; native and xterm remain available for renderer comparisons.
  const renderer = process.env.MUXED_TERMINAL_RENDERER;
  const devUrl = renderer
    ? `${origin}/?terminalRenderer=${encodeURIComponent(renderer)}`
    : origin;
  return {
    productName: "Ticketry Dev",
    identifier: "com.ticketry.desktop.dev",
    build: {
      beforeDevCommand: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
      devUrl,
    },
    app: {
      windows: [{
        label: "main",
        title: "Ticketry Dev",
        width: 1440,
        height: 960,
        minWidth: 1024,
        minHeight: 700,
        resizable: true,
        zoomHotkeysEnabled: true,
        dragDropEnabled: false,
      }],
    },
  };
}

export function formatDevelopmentIdentity({
  frontendOrigin,
  dataDirectory,
  tmuxSocket,
}) {
  return [
    "Ticketry Dev instance:",
    `frontend=${frontendOrigin}`,
    "runtime=in-process-rust",
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

export async function main() {
  const options = parseDesktopDevOptions(process.argv.slice(2));
  const { dataDirectory, tmuxSocket } = resolveDesktopDevelopmentProfile({ options });
  const logPath = prepareDevelopmentLog();
  const buildEnvironment = {
    ...process.env,
    MUXED_DATA_DIR: dataDirectory,
    MUXED_DEVELOPMENT_LOG_PATH: logPath,
    MUXED_ENABLE_LOCAL_POSTGRES: "true",
    MUXED_TMUX_SOCKET: tmuxSocket,
  };
  if (options.temporarySqlite) {
    buildEnvironment.MUXED_FORCE_SQLITE = "true";
  }
  try {
    const frontendPort = await selectFrontendPort({
      requestedPort: process.env.MUXED_FRONTEND_PORT,
    });
    const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
    const environment = {
      ...buildEnvironment,
      MUXED_DESKTOP_ORIGIN: frontendOrigin,
    };
    const config = JSON.stringify(buildTauriDevelopmentConfig(frontendPort));
    console.log(formatDevelopmentIdentity({
      frontendOrigin,
      dataDirectory,
      tmuxSocket,
    }));
    if (options.mode === productionDataMode) {
      console.log("Ticketry Dev is using writable production data; the installed app must remain closed.");
    }
    console.log(`Ticketry development logs: ${logPath}`);
    await run(process.execPath, [
      resolveTauriCliPath(),
      "dev",
      "--no-watch",
      "--config",
      config,
      "--features",
      "native-libghostty",
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
