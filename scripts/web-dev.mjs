import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";

import { createDevelopmentLogCapture } from "./dev-log-capture.mjs";
import {
  createTemporarySqliteProfile,
  removeTemporarySqliteProfile,
  resolveDevelopmentDataDirectory,
  stopTemporaryTmuxServer,
} from "../studio/scripts/desktop-dev.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const useProcessGroups = process.platform !== "win32";
const children = new Set();
const portCandidates = 10;
const defaultMcpPort = 8123;

let stopping = false;
let exitCode = 0;
let forceStopTimer;
let shutdownCleanup;
let developmentLogs;

function writeWebLine(channel, message) {
  if (developmentLogs) {
    developmentLogs.write("web", channel, `${message}\n`);
    return;
  }
  const output = channel === "stderr" ? console.error : console.log;
  output(message);
}

function captureChildOutput(child, source) {
  child.stdout?.on("data", (chunk) => {
    developmentLogs?.write(source, "stdout", chunk);
  });
  child.stderr?.on("data", (chunk) => {
    developmentLogs?.write(source, "stderr", chunk);
  });
  child.stdout?.once("end", () => developmentLogs?.flush(source, "stdout"));
  child.stderr?.once("end", () => developmentLogs?.flush(source, "stderr"));
}

export function parseWebDevOptions(args = []) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized.length === 0) return { temporarySqlite: false };
  if (normalized.length === 1 && normalized[0] === "--temp-sqlite") {
    return { temporarySqlite: true };
  }
  throw new Error("usage: npm run web -- [--temp-sqlite]");
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

function parsePort(name, value) {
  if (!/^\d+$/.test(value ?? "") || Number(value) < 1 || Number(value) > 65_535) {
    throw new Error(`${name} must be a valid TCP port (1-65535)`);
  }
  return Number(value);
}

export async function selectWebPort({
  name,
  requestedPort,
  firstPort,
  isAvailable = canListen,
}) {
  if (requestedPort !== undefined) {
    const port = parsePort(name, String(requestedPort));
    if (!await isAvailable(port)) {
      throw new Error(`Requested ${name} ${port} is unavailable`);
    }
    return port;
  }

  for (let offset = 0; offset < portCandidates; offset += 1) {
    const port = firstPort + offset;
    if (await isAvailable(port)) return port;
  }
  throw new Error(
    `No ${name} is available in ${firstPort}-${firstPort + portCandidates - 1}`,
  );
}

export async function selectTemporaryMcpPort({ isAvailable = canListen } = {}) {
  return await isAvailable(defaultMcpPort) ? defaultMcpPort : null;
}

export async function selectWebMcpPort({
  environment = process.env,
  isAvailable = canListen,
} = {}) {
  return selectWebPort({
    name: "MCP port",
    requestedPort: environment.MUXED_WEB_MCP_PORT,
    firstPort: defaultMcpPort,
    isAvailable,
  });
}

export function buildWebFrontendCommand(frontendPort) {
  return [
    "npm run dev --workspace @worktracker/studio --",
    "--host 127.0.0.1",
    `--port ${frontendPort}`,
    "--strictPort",
    "--open",
  ].join(" ");
}

export function buildWebMcpCommand() {
  return "uv run --project surfaces/worktracker-agent python -m worktracker_agent.mcp.main";
}

export function buildWebRuntimeEnvironment({
  environment,
  backendPort,
  mcpPort = defaultMcpPort,
}) {
  const backendOrigin = `http://127.0.0.1:${backendPort}`;
  const apiKey = environment.WORKTRACKER_API_KEY ?? environment.WORKTRACKER_API_TOKEN;

  const runtimeEnvironment = {
    ...environment,
    ...(apiKey ? { WORKTRACKER_API_KEY: apiKey } : {}),
    MUXED_BACKEND_PORT: String(backendPort),
    MUXED_VITE_BACKEND_ORIGIN: backendOrigin,
    MUXED_WEB_BACKEND_PORT: String(backendPort),
    STUDIO_RUN_CONTROL_URL: `${backendOrigin}/api/terminals/self-terminate`,
    WORKTRACKER_BASE_URL: `${backendOrigin}/api/work-tracker`,
  };
  if (mcpPort === null) {
    delete runtimeEnvironment.MCP_HOST;
    delete runtimeEnvironment.MCP_PORT;
    delete runtimeEnvironment.MCP_TRANSPORT;
    delete runtimeEnvironment.WORKTRACKER_MCP_URL;
  } else {
    runtimeEnvironment.MCP_HOST = "127.0.0.1";
    runtimeEnvironment.MCP_PORT = String(mcpPort);
    runtimeEnvironment.MCP_TRANSPORT = "http";
    runtimeEnvironment.WORKTRACKER_MCP_URL = `http://127.0.0.1:${mcpPort}/mcp`;
  }
  return runtimeEnvironment;
}

function start(name, command, environment, { optional = false } = {}) {
  const child = spawn(command, {
    cwd: root,
    detached: useProcessGroups,
    env: environment,
    shell: true,
    stdio: ["inherit", "pipe", "pipe"],
  });
  captureChildOutput(child, name);

  let failedToSpawn = false;
  children.add(child);
  child.once("error", (error) => {
    failedToSpawn = true;
    children.delete(child);
    writeWebLine(
      "stderr",
      `[web] Could not start ${optional ? `optional ${name}; continuing without it` : name}: ${error.message}`,
    );
    if (!optional && !stopping) {
      stopping = true;
      exitCode = 1;
      stopChildren("SIGTERM");
      scheduleForceStop();
    }
    finishIfStopped();
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (failedToSpawn) {
      finishIfStopped();
      return;
    }

    if (optional && !stopping) {
      writeWebLine(
        "stderr",
        `[web] Optional ${name} stopped${signal ? ` (${signal})` : ` with exit code ${code ?? 1}`}; continuing without it.`,
      );
      return;
    }

    if (!stopping) {
      stopping = true;
      exitCode = code ?? (signal ? 1 : 0);
      writeWebLine(
        "stderr",
        `[web] ${name} stopped${signal ? ` (${signal})` : ` with exit code ${exitCode}`}; shutting down.`,
      );
      stopChildren("SIGTERM");
      scheduleForceStop();
    }

    finishIfStopped();
  });
}

function runDjangoCommand(args, environment, label) {
  writeWebLine("stdout", `[web] ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "python", "manage.py", ...args], {
      cwd: path.join(root, "backend"),
      detached: useProcessGroups,
      env: environment,
      stdio: ["inherit", "pipe", "pipe"],
    });
    captureChildOutput(child, `django-${args[0]}`);

    children.add(child);
    child.once("error", (error) => {
      children.delete(child);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `${label} was interrupted by ${signal}`
            : `${label} exited with code ${code ?? 1}`,
        ),
      );
    });
  });
}

export function buildWebDevelopmentEnvironment({
  cwd = root,
  environment = process.env,
  temporarySqlite = false,
  temporaryRoot,
} = {}) {
  const dataDirectory = temporarySqlite
    ? createTemporarySqliteProfile({ temporaryRoot })
    : path.resolve(
      cwd,
      resolveDevelopmentDataDirectory({ cwd, environment }),
    );
  const tmuxSocket = `muxed-dev-${
    createHash("sha256")
      .update(dataDirectory)
      .digest("hex")
      .slice(0, 16)
  }`;

  return {
    dataDirectory,
    temporarySqlite,
    environment: {
      ...environment,
      MUXED_ADMIN_ENABLED: "true",
      MUXED_ENABLE_LOCAL_POSTGRES: "true",
      MUXED_DATA_DIR: dataDirectory,
      MUXED_DESKTOP_ORIGIN: "",
      MUXED_STATE_DB: path.join(dataDirectory, "state.db"),
      MUXED_TMUX_SOCKET: tmuxSocket,
      ...(temporarySqlite ? { MUXED_FORCE_SQLITE: "true" } : {}),
      // This stack only listens on loopback. Developers can explicitly set
      // false and provide matching backend/frontend tokens to exercise auth.
      WORKTRACKER_DISABLE_AUTH:
        environment.WORKTRACKER_DISABLE_AUTH ?? "true",
    },
  };
}

export function cleanupTemporaryWebLaunch(
  launch,
  {
    stopTmux = stopTemporaryTmuxServer,
    removeProfile = removeTemporarySqliteProfile,
    log = console.log,
  } = {},
) {
  stopTmux(launch.environment.MUXED_TMUX_SOCKET);
  removeProfile(launch.dataDirectory);
  log(`[web] Removed temporary SQLite profile: ${launch.dataDirectory}`);
}

async function prepareDjango(environment) {
  await runDjangoCommand(
    ["migrate", "--noinput"],
    environment,
    "Applying pending Django migrations",
  );
  await runDjangoCommand(
    [
      "provision",
      "--admin-username",
      "admin",
      "--admin-password",
      "admin",
    ],
    environment,
    "Provisioning the isolated development workspace",
  );
  await runDjangoCommand(
    [
      "shell",
      "-c",
      [
        "from apps.settings_store.service import ensure_local_profile",
        "ensure_local_profile(name='Local', workspace_slug='meml')",
      ].join("; "),
    ],
    environment,
    "Ensuring the local development profile",
  );
}

function stopChildren(signal) {
  for (const child of children) {
    if (child.pid === undefined) {
      continue;
    }

    try {
      if (useProcessGroups) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch (error) {
      if (error?.code !== "ESRCH") {
        writeWebLine(
          "stderr",
          `[web] Could not stop process ${child.pid}: ${error.message}`,
        );
      }
    }
  }
}

function scheduleForceStop() {
  forceStopTimer ??= setTimeout(() => {
    stopChildren("SIGKILL");
  }, 5_000);
  forceStopTimer.unref();
}

function finishIfStopped() {
  if (!stopping || children.size > 0) {
    return;
  }

  if (forceStopTimer) {
    clearTimeout(forceStopTimer);
  }
  const cleanup = shutdownCleanup;
  shutdownCleanup = undefined;
  if (cleanup) {
    try {
      cleanup();
    } catch (error) {
      exitCode ||= 1;
      writeWebLine(
        "stderr",
        `[web] Temporary SQLite cleanup failed: ${error.message}`,
      );
    }
  }
  developmentLogs?.close();
  developmentLogs = undefined;
  process.exitCode = exitCode;
}

function handleSignal(signal, code) {
  if (stopping) {
    stopChildren("SIGKILL");
    return;
  }

  stopping = true;
  exitCode = code;
  stopChildren(signal);
  scheduleForceStop();
  finishIfStopped();
}

export async function main() {
  developmentLogs = createDevelopmentLogCapture();
  process.on("SIGINT", () => handleSignal("SIGINT", 130));
  process.on("SIGTERM", () => handleSignal("SIGTERM", 143));

  const options = parseWebDevOptions(process.argv.slice(2));
  const launch = buildWebDevelopmentEnvironment({
    temporarySqlite: options.temporarySqlite,
  });
  if (launch.temporarySqlite) {
    shutdownCleanup = () => cleanupTemporaryWebLaunch(launch);
  }
  mkdirSync(launch.dataDirectory, { recursive: true });

  writeWebLine("stdout", `[web] Development data: ${launch.dataDirectory}`);
  writeWebLine("stdout", `[web] Development logs: ${developmentLogs.logPath}`);
  writeWebLine("stdout", "[web] Press Ctrl+C to stop both services.");

  try {
    await prepareDjango(launch.environment);
    if (!stopping) {
      const backendPort = await selectWebPort({
        name: "backend port",
        requestedPort: launch.environment.MUXED_WEB_BACKEND_PORT,
        firstPort: 8787,
      });
      const frontendPort = await selectWebPort({
        name: "frontend port",
        requestedPort: launch.environment.MUXED_FRONTEND_PORT,
        firstPort: 5174,
      });
      const mcpPort = launch.temporarySqlite
        ? await selectTemporaryMcpPort()
        : await selectWebMcpPort({
          environment: launch.environment,
        });
      const backendOrigin = `http://127.0.0.1:${backendPort}`;
      const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
      const runtimeEnvironment = buildWebRuntimeEnvironment({
        environment: launch.environment,
        backendPort,
        mcpPort,
      });

      writeWebLine("stdout", `[web] Starting backend at ${backendOrigin}`);
      writeWebLine("stdout", `[web] Starting Ticketry at ${frontendOrigin}`);
      if (mcpPort === null) {
        writeWebLine(
          "stdout",
          "[web] MCP port 8123 is unavailable; continuing without MCP.",
        );
      } else {
        writeWebLine(
          "stdout",
          `[web] Starting WorkTracker MCP at http://127.0.0.1:${mcpPort}/mcp`,
        );
      }
      start("backend", "./scripts/dev.sh backend", runtimeEnvironment);
      if (mcpPort !== null) {
        start("MCP", buildWebMcpCommand(), runtimeEnvironment, {
          optional: launch.temporarySqlite,
        });
      }
      start(
        "frontend",
        buildWebFrontendCommand(frontendPort),
        runtimeEnvironment,
      );
    }
  } catch (error) {
    if (!stopping) {
      stopping = true;
      exitCode = 1;
      writeWebLine(
        "stderr",
        `[web] Could not start web development: ${error.message}`,
      );
    }
    finishIfStopped();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    writeWebLine("stderr", `[web] Launch failed: ${error.message}`);
    developmentLogs?.close();
    developmentLogs = undefined;
    process.exitCode = 1;
  });
}
