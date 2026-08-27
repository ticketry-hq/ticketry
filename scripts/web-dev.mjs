import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";

import { createDevelopmentLogCapture } from "./dev-log-capture.mjs";
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

export function parseWebDevOptions(args = []) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized.length === 0) return { temporarySqlite: false };
  if (normalized.length === 1 && normalized[0] === "--temp-sqlite") {
    return { temporarySqlite: true };
  }
  throw new Error("usage: npm run web -- [--temp-sqlite]");
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

async function waitUntilGraphqlReady(port, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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
  temporaryRoot,
} = {}) {
  const dataDirectory = temporarySqlite
    ? createTemporarySqliteProfile({ temporaryRoot })
    : path.resolve(cwd, resolveDevelopmentDataDirectory({ cwd, environment }));
  return {
    dataDirectory,
    temporarySqlite,
    environment: {
      ...environment,
      MUXED_DATA_DIR: dataDirectory,
      MUXED_TMUX_SOCKET: resolveDevelopmentTmuxSocket(dataDirectory),
    },
  };
}

export function cleanupTemporaryWebLaunch(launch) {
  stopTemporaryTmuxServer(launch.environment.MUXED_TMUX_SOCKET);
  removeTemporarySqliteProfile(launch.dataDirectory);
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
    if (children.size === 0) logs.close();
  });
  child.once("error", (error) => console.error(`[web] Could not start ${name}: ${error.message}`));
}

export async function main() {
  const options = parseWebDevOptions(process.argv.slice(2));
  const launch = buildWebDevelopmentEnvironment({ temporarySqlite: options.temporarySqlite });
  mkdirSync(launch.dataDirectory, { recursive: true });
  const adapterPort = await selectWebPort({
    requestedPort: process.env.TICKETRY_GRAPHQL_ADAPTER_PORT,
    firstPort: 8790,
  });
  const mcpPort = await selectWebPort({
    requestedPort: process.env.MUXED_DESKTOP_MCP_PORT ?? 8123,
    firstPort: 8123,
  });
  const frontendPort = await selectWebPort({
    requestedPort: process.env.MUXED_FRONTEND_PORT,
    firstPort: 5174,
  });
  const hookRunner = prepareWebHookRunner();
  const logs = createDevelopmentLogCapture();
  const environment = {
    ...launch.environment,
    TICKETRY_GRAPHQL_ADAPTER_PORT: String(adapterPort),
    TICKETRY_GRAPHQL_ADAPTER_HOOK_RUNNER: hookRunner,
    MUXED_DESKTOP_MCP_PORT: String(mcpPort),
    MUXED_VITE_GRAPHQL_ORIGIN: `http://127.0.0.1:${adapterPort}`,
  };
  const stop = (signal) => {
    stopping = true;
    for (const child of children) child.kill(signal);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  start("rust-graphql", "cargo", ["run", "--locked", "--manifest-path",
    "studio/src-tauri/Cargo.toml", "--features", "development-tools", "--bin", "ticketry_graphql_adapter"], environment, logs);
  await waitUntilGraphqlReady(adapterPort);
  const [frontend, ...frontendArgs] = buildWebFrontendCommand(frontendPort);
  start("frontend", frontend, frontendArgs, environment, logs);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[web] Launch failed: ${error.message}`);
    process.exitCode = 1;
  });
}
