import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  selectWebPort,
  waitUntilGraphqlReady,
} from "../../../scripts/web-dev.mjs";
import {
  createTemporarySqliteProfile,
  removeTemporarySqliteProfile,
  resolveDevelopmentTmuxSocket,
  stopTemporaryTmuxServer,
} from "../desktop-dev.mjs";
import { adapterBinaryPath, repositoryRoot, studioRoot } from "./paths.mjs";

/**
 * The isolated runtime one profiling run measures.
 *
 * A fresh temporary SQLite profile and a private tmux server, every time. The
 * live Ticketry database is never read, copied, seeded or written here, and
 * cleanup only ever stops processes this module started.
 *
 * Ports are dedicated so a run can never silently attach to a development
 * stack that happens to be listening: an explicitly requested port that is
 * occupied is a failure, not an invitation to reuse somebody else's server.
 */
const DEFAULT_ADAPTER_PORT = 8890;
const DEFAULT_FRONTEND_PORT = 4273;

/**
 * `selectWebPort` treats any value that is not `undefined` as an explicit
 * demand, and the option parsers use null for "not asked for". Collapsing the
 * two here keeps an unspecified port on the dedicated-then-next-free path
 * instead of failing as a request for port "null".
 */
function requested(port) {
  return port === null || port === undefined ? undefined : port;
}

function startTemporaryProfileWatchdog(dataDirectory, tmuxSocket) {
  const script = path.join(repositoryRoot, "scripts", "temporary-profile-watchdog.mjs");
  const watchdog = spawn(
    process.execPath,
    [script, dataDirectory, String(process.pid), tmuxSocket],
    { detached: true, stdio: "ignore" },
  );
  watchdog.unref();
  return watchdog;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  const killed = once(child, "exit");
  child.kill("SIGKILL");
  await killed;
}

async function waitForFrontend(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response yet";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok && (await response.text()).includes("<div id=\"root\"")) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`the profiling frontend did not answer on port ${port}: ${lastError}`);
}

export function hookRunnerPath() {
  return path.join(
    studioRoot,
    "src-tauri",
    "target",
    "debug",
    `ticketry-hook${process.platform === "win32" ? ".exe" : ""}`,
  );
}

/**
 * The Rust GraphQL adapter, already built, bound to a caller-owned profile.
 *
 * The desktop confirmation run reuses this to seed its isolated database over
 * HTTP before the desktop application opens the same directory; the browser
 * runtime below wraps it with a preview server.
 */
export async function startProfilingAdapter({
  dataDirectory,
  tmuxSocket,
  adapterProfile = "debug",
  requestedAdapterPort,
  logSink = process.stderr,
}) {
  const adapterPort = await selectWebPort({
    requestedPort: requested(requestedAdapterPort),
    firstPort: DEFAULT_ADAPTER_PORT,
  });
  const child = spawn(adapterBinaryPath(adapterProfile), [], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MUXED_DATA_DIR: dataDirectory,
      MUXED_FORCE_SQLITE: "true",
      MUXED_TMUX_SOCKET: tmuxSocket,
      TICKETRY_GRAPHQL_ADAPTER_PORT: String(adapterPort),
      TICKETRY_GRAPHQL_ADAPTER_HOOK_RUNNER: hookRunnerPath(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logSink.write(`[adapter] ${chunk}`));
  child.stderr.on("data", (chunk) => logSink.write(`[adapter] ${chunk}`));
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  try {
    await waitUntilGraphqlReady(adapterPort, 180_000, () => exited);
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return {
    port: adapterPort,
    origin: `http://127.0.0.1:${adapterPort}`,
    stop: () => stopChild(child),
  };
}

export async function startPerformanceRuntime({
  adapterProfile = "debug",
  requestedAdapterPort,
  requestedFrontendPort,
  logSink = process.stderr,
} = {}) {
  const dataDirectory = createTemporarySqliteProfile();
  const tmuxSocket = resolveDevelopmentTmuxSocket(dataDirectory);
  mkdirSync(dataDirectory, { recursive: true });
  // Record what the run actually owns, resolved, so the report can prove the
  // measurement never touched a product profile.
  const resolvedDataDirectory = realpathSync(dataDirectory);

  const frontendPort = await selectWebPort({
    requestedPort: requested(requestedFrontendPort),
    firstPort: DEFAULT_FRONTEND_PORT,
  });
  const watchdog = startTemporaryProfileWatchdog(dataDirectory, tmuxSocket);
  let adapter = null;
  let previewServer = null;
  let stopped = false;

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      await previewServer?.close();
    } catch (error) {
      logSink.write(`[performance] preview server did not close cleanly: ${error.message}\n`);
    }
    await adapter?.stop();
    stopTemporaryTmuxServer(tmuxSocket);
    try {
      removeTemporarySqliteProfile(dataDirectory);
    } catch (error) {
      logSink.write(`[performance] temporary profile not removed: ${error.message}\n`);
    }
    try {
      watchdog.kill("SIGTERM");
    } catch {
      // The watchdog exits on its own when the parent goes away.
    }
  };

  try {
    adapter = await startProfilingAdapter({
      dataDirectory,
      tmuxSocket,
      adapterProfile,
      requestedAdapterPort,
      logSink,
    });

    // Preview serves the prepared bundle through the same proxy table the dev
    // server uses, so GraphQL, the SSE subscription route, documents and the
    // terminal WebSocket upgrade all reach this run's own adapter.
    process.env.MUXED_VITE_GRAPHQL_ORIGIN = adapter.origin;
    const { preview } = await import("vite");
    previewServer = await preview({
      root: studioRoot,
      configFile: path.join(studioRoot, "vite.performance.config.ts"),
      preview: {
        host: "127.0.0.1",
        port: frontendPort,
        strictPort: true,
        open: false,
      },
    });
    await waitForFrontend(frontendPort);
  } catch (error) {
    await stop();
    throw error;
  }

  return {
    dataDirectory: resolvedDataDirectory,
    tmuxSocket,
    adapterPort: adapter.port,
    frontendPort,
    adapterOrigin: adapter.origin,
    baseURL: `http://127.0.0.1:${frontendPort}`,
    adapterProfile,
    stop,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Standalone use: open the isolated optimized runtime and hold it until
  // interrupted. Exit criterion for step 1 of the profiling plan.
  const runtime = await startPerformanceRuntime({
    adapterProfile: process.env.TICKETRY_PERF_ADAPTER_PROFILE ?? "debug",
  });
  console.log(
    `[performance] app=${runtime.baseURL} adapter=${runtime.adapterOrigin}/graphql `
    + `data=${runtime.dataDirectory} tmux=${runtime.tmuxSocket}`,
  );
  const shutdown = (signal) => {
    void runtime.stop().finally(() => process.kill(process.pid, signal));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
