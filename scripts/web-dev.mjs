import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";

import { createDevelopmentLogCapture } from "./dev-log-capture.mjs";
import { loadWebDevDefaults } from "./web-dev-defaults.mjs";
import {
  resolveProductDataDirectory,
} from "./product-identity.mjs";
import {
  createTemporarySqliteProfile,
  removeTemporarySqliteProfile,
  resolveDevelopmentDataDirectory,
  resolveDevelopmentTmuxSocket,
  stopTemporaryTmuxServer,
} from "../studio/scripts/desktop-dev.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = new Set();
let stopping = false;
let cleanupLaunch = null;

function cleanupActiveLaunch() {
  cleanupLaunch?.();
  cleanupLaunch = null;
}

function startTemporaryProfileWatchdog(launch) {
  if (!launch.temporaryProfile) return;
  const script = fileURLToPath(new URL("./temporary-profile-watchdog.mjs", import.meta.url));
  const watchdog = spawn(process.execPath, [
    script,
    launch.dataDirectory,
    String(process.pid),
    launch.environment.MUXED_TMUX_SOCKET,
  ], {
    detached: true,
    stdio: "ignore",
  });
  watchdog.unref();
}

export function parseWebDevOptions(args = []) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  const supported = new Set([
    "--development-profile",
    "--temp-sqlite",
    "--log-to-file",
  ]);
  if (normalized.some((option) => !supported.has(option))) {
    throw new Error(
      "usage: npm run web or npm run web:dev -- [--temp-sqlite] [--log-to-file]",
    );
  }
  return {
    developmentProfile: normalized.includes("--development-profile"),
    temporarySqlite: normalized.includes("--temp-sqlite"),
    logToFile: normalized.includes("--log-to-file"),
  };
}

export function withWebFileLogging(environment, { enabled, logPath }) {
  const configured = { ...environment };
  delete configured.MUXED_DEVELOPMENT_LOG_PATH;
  delete configured.VITE_TICKETRY_WEB_FILE_LOGGING;
  if (enabled) {
    configured.MUXED_DEVELOPMENT_LOG_PATH = logPath;
    configured.VITE_TICKETRY_WEB_FILE_LOGGING = "true";
  }
  return configured;
}

function canListen(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (["EADDRINUSE", "EACCES"].includes(error.code)) resolve(false);
      else reject(error);
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
      server.close((error) => error ? reject(error) : resolve(true)));
  });
}

async function isGraphqlReady(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "mutation WebDevelopmentReadiness { __typename }",
        operationName: "WebDevelopmentReadiness",
        variables: {},
      }),
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return !payload.errors && payload.data?.__typename === "Mutation";
  } catch {
    return false;
  }
}

export async function waitUntilGraphqlReady(
  port,
  timeoutMs = 180_000,
  shouldStop = () => false,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shouldStop()) {
      throw new Error("GraphQL adapter stopped before it became ready; run npm run logs");
    }
    if (await isGraphqlReady(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`GraphQL adapter did not become ready on port ${port}`);
}

export async function selectWebPort({ requestedPort, firstPort, isAvailable = canListen }) {
  if (requestedPort !== undefined) {
    const port = Number(requestedPort);
    if (!Number.isInteger(port) || port < 1 || port > 65_535 || !await isAvailable(port)) {
      throw new Error(`Requested port ${requestedPort} is unavailable`);
    }
    return port;
  }
  for (let offset = 0; offset < 10; offset += 1) {
    const port = firstPort + offset;
    if (await isAvailable(port)) return port;
  }
  throw new Error(`No port is available in ${firstPort}-${firstPort + 9}`);
}

export function configuredWebPort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a port between 1 and 65535`);
  }
  return port;
}

export function buildWebFrontendCommand(frontendPort) {
  return ["npm", "run", "dev", "--workspace", "@worktracker/studio", "--",
    "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort", "--open"];
}

export function buildWebHookRunnerCommand({
  cwd = root,
  platform = process.platform,
} = {}) {
  const executable = `ticketry-hook${platform === "win32" ? ".exe" : ""}`;
  const output = path.join(cwd, "studio", "src-tauri", "target", "debug", executable);
  return {
    command: "rustc",
    args: [
      path.join(cwd, "studio", "src-tauri", "native", "ticketry_hook.rs"),
      "--edition",
      "2021",
      "-o",
      output,
    ],
    output,
  };
}

function prepareWebHookRunner() {
  const build = buildWebHookRunnerCommand();
  mkdirSync(path.dirname(build.output), { recursive: true });
  const result = spawnSync(build.command, build.args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`Could not build ticketry-hook: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Could not build ticketry-hook: rustc exited with ${result.status}`);
  }
  return build.output;
}

export function buildWebDevelopmentEnvironment({
  cwd = root,
  environment = process.env,
  temporarySqlite = false,
  developmentProfile = false,
  temporaryRoot,
  resolveProductData = resolveProductDataDirectory,
  resolveDevelopmentData = resolveDevelopmentDataDirectory,
} = {}) {
  const explicitDataDirectory = environment.MUXED_DATA_DIR;
  const productDataDirectory = !temporarySqlite
      && !developmentProfile
      && !explicitDataDirectory
    ? resolveProductData({ cwd, environment })
    : null;
  const dataDirectory = temporarySqlite
    ? createTemporarySqliteProfile({ temporaryRoot })
    : explicitDataDirectory
      ? path.resolve(cwd, resolveDevelopmentData({ cwd, environment }))
      : developmentProfile
        ? resolveDevelopmentData({ cwd, environment })
        : productDataDirectory;
  const tmuxSocket = environment.MUXED_TMUX_SOCKET
    ?? (productDataDirectory ? "muxed" : resolveDevelopmentTmuxSocket(dataDirectory));
  const launchEnvironment = {
    ...environment,
    MUXED_DATA_DIR: dataDirectory,
    MUXED_TMUX_SOCKET: tmuxSocket,
  };
  if (temporarySqlite) launchEnvironment.MUXED_FORCE_SQLITE = "true";
  return {
    dataDirectory,
    developmentProfile,
    productDataDirectory,
    temporaryProfile: temporarySqlite,
    temporarySqlite,
    environment: launchEnvironment,
  };
}

export function cleanupTemporaryWebLaunch(launch) {
  if (!launch.temporaryProfile) return;
  removeTemporarySqliteProfile(launch.dataDirectory);
  stopTemporaryTmuxServer(launch.environment.MUXED_TMUX_SOCKET);
}

function start(name, command, args, environment, logs) {
  const child = spawn(command, args, {
    cwd: root,
    env: environment,
    stdio: ["inherit", "pipe", "pipe"],
  });
  children.add(child);
  child.stdout?.on("data", (chunk) => logs.write(name, "stdout", chunk));
  child.stderr?.on("data", (chunk) => logs.write(name, "stderr", chunk));
  child.once("exit", (code) => {
    children.delete(child);
    if (!stopping) {
      stopping = true;
      process.exitCode = code ?? 1;
      for (const running of children) running.kill("SIGTERM");
    }
    if (children.size === 0) {
      logs.close();
      cleanupActiveLaunch();
    }
  });
  child.once("error", (error) => console.error(`[web] Could not start ${name}: ${error.message}`));
}

export async function main() {
  const options = parseWebDevOptions(process.argv.slice(2));
  const defaults = loadWebDevDefaults();
  const logToFile = options.logToFile || defaults.logToFile;
  const launch = buildWebDevelopmentEnvironment({
    environment: defaults.environment,
    developmentProfile: options.developmentProfile,
    temporarySqlite: options.temporarySqlite,
  });
  cleanupLaunch = () => cleanupTemporaryWebLaunch(launch);
  process.once("exit", cleanupActiveLaunch);
  startTemporaryProfileWatchdog(launch);
  mkdirSync(launch.dataDirectory, { recursive: true });
  const adapterPort = defaults.reuseGraphqlAdapter
    ? configuredWebPort(
        defaults.environment.TICKETRY_GRAPHQL_ADAPTER_PORT,
        "TICKETRY_GRAPHQL_ADAPTER_PORT",
      )
    : await selectWebPort({
        requestedPort: defaults.environment.TICKETRY_GRAPHQL_ADAPTER_PORT,
        firstPort: 8790,
      });
  const mcpPort = defaults.reuseGraphqlAdapter
    ? configuredWebPort(
        defaults.environment.MUXED_DESKTOP_MCP_PORT ?? 8123,
        "MUXED_DESKTOP_MCP_PORT",
      )
    : await selectWebPort({
        requestedPort: defaults.environment.MUXED_DESKTOP_MCP_PORT ?? 8123,
        firstPort: 8123,
      });
  const frontendPort = await selectWebPort({
    requestedPort: defaults.environment.MUXED_FRONTEND_PORT,
    firstPort: 5174,
  });
  const hookRunner = defaults.reuseGraphqlAdapter
    ? defaults.environment.TICKETRY_GRAPHQL_ADAPTER_HOOK_RUNNER
    : prepareWebHookRunner();
  const logs = createDevelopmentLogCapture();
  const environment = withWebFileLogging({
    ...launch.environment,
    TICKETRY_GRAPHQL_ADAPTER_PORT: String(adapterPort),
    TICKETRY_GRAPHQL_ADAPTER_HOOK_RUNNER: hookRunner,
    MUXED_DESKTOP_MCP_PORT: String(mcpPort),
    MUXED_VITE_GRAPHQL_ORIGIN: `http://127.0.0.1:${adapterPort}`,
  }, { enabled: logToFile, logPath: logs.logPath });
  const dataSource = launch.productDataDirectory
    ? `product profile ${launch.productDataDirectory}`
    : launch.temporarySqlite
      ? "empty temporary SQLite profile"
      : launch.developmentProfile
        ? `development profile ${launch.dataDirectory}`
        : `explicit profile ${launch.dataDirectory}`;
  console.log(
    `[web] data=${launch.dataDirectory} source=${dataSource} mcp=http://127.0.0.1:${mcpPort}/mcp`,
  );
  if (defaults.reuseGraphqlAdapter) {
    console.log(`[web] reusing GraphQL adapter=http://127.0.0.1:${adapterPort}/graphql`);
  }
  if (logToFile) {
    console.log(`[web] frontend and story-move logs=${logs.logPath}`);
  }
  const stop = (signal) => {
    stopping = true;
    for (const child of children) child.kill(signal);
    cleanupActiveLaunch();
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  if (!defaults.reuseGraphqlAdapter) {
    start("rust-graphql", "cargo", ["run", "--locked", "--manifest-path",
      "studio/src-tauri/Cargo.toml", "--features", "development-tools", "--bin", "ticketry_graphql_adapter"], environment, logs);
  }
  await waitUntilGraphqlReady(adapterPort, 180_000, () => stopping);
  const [frontend, ...frontendArgs] = buildWebFrontendCommand(frontendPort);
  start("frontend", frontend, frontendArgs, environment, logs);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (children.size === 0) {
      cleanupActiveLaunch();
    }
    console.error(`[web] Launch failed: ${error.message}`);
    process.exitCode = 1;
  });
}
