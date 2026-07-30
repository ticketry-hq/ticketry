import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";

import { resolveDevelopmentDataDirectory } from "../studio/scripts/desktop-dev.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const useProcessGroups = process.platform !== "win32";
const children = new Set();
const portCandidates = 10;

let stopping = false;
let exitCode = 0;
let forceStopTimer;

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

export function buildWebFrontendCommand(frontendPort) {
  return [
    "npm run dev --workspace @worktracker/studio --",
    "--host 127.0.0.1",
    `--port ${frontendPort}`,
    "--strictPort",
    "--open",
  ].join(" ");
}

function start(name, command, environment) {
  const child = spawn(command, {
    cwd: root,
    detached: useProcessGroups,
    env: environment,
    shell: true,
    stdio: "inherit",
  });

  children.add(child);
  child.once("error", (error) => {
    console.error(`[web] Could not start ${name}: ${error.message}`);
  });
  child.once("exit", (code, signal) => {
    children.delete(child);

    if (!stopping) {
      stopping = true;
      exitCode = code ?? (signal ? 1 : 0);
      console.error(
        `[web] ${name} stopped${signal ? ` (${signal})` : ` with exit code ${exitCode}`}; shutting down.`,
      );
      stopChildren("SIGTERM");
      scheduleForceStop();
    }

    finishIfStopped();
  });
}

function runDjangoCommand(args, environment, label) {
  console.log(`[web] ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "python", "manage.py", ...args], {
      cwd: path.join(root, "backend"),
      detached: useProcessGroups,
      env: environment,
      stdio: "inherit",
    });

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
} = {}) {
  const dataDirectory = path.resolve(
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
    environment: {
      ...environment,
      MUXED_ADMIN_ENABLED: "true",
      MUXED_DATA_DIR: dataDirectory,
      MUXED_DESKTOP_ORIGIN: "",
      MUXED_SKIP_LOCAL_STATE_MIGRATION: "1",
      MUXED_STATE_DB: path.join(dataDirectory, "state.db"),
      MUXED_TMUX_SOCKET: tmuxSocket,
      // This stack only listens on loopback. Developers can explicitly set
      // false and provide matching backend/frontend tokens to exercise auth.
      WORKTRACKER_DISABLE_AUTH:
        environment.WORKTRACKER_DISABLE_AUTH ?? "true",
    },
  };
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
        console.error(`[web] Could not stop process ${child.pid}: ${error.message}`);
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
  process.on("SIGINT", () => handleSignal("SIGINT", 130));
  process.on("SIGTERM", () => handleSignal("SIGTERM", 143));

  const launch = buildWebDevelopmentEnvironment();
  mkdirSync(launch.dataDirectory, { recursive: true });

  console.log(`[web] Development data: ${launch.dataDirectory}`);
  console.log("[web] Press Ctrl+C to stop both services.");

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
      const backendOrigin = `http://127.0.0.1:${backendPort}`;
      const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
      const runtimeEnvironment = {
        ...launch.environment,
        MUXED_VITE_BACKEND_ORIGIN: backendOrigin,
        MUXED_WEB_BACKEND_PORT: String(backendPort),
      };

      console.log(`[web] Starting backend at ${backendOrigin}`);
      console.log(`[web] Starting Ticketry at ${frontendOrigin}`);
      start("backend", "./scripts/dev.sh backend", runtimeEnvironment);
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
      console.error(`[web] Could not start web development: ${error.message}`);
    }
    finishIfStopped();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[web] Launch failed: ${error.message}`);
    process.exitCode = 1;
  });
}
