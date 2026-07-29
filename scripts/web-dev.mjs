import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const useProcessGroups = process.platform !== "win32";
const children = new Set();

let stopping = false;
let exitCode = 0;
let forceStopTimer;

function start(name, command) {
  const child = spawn(command, {
    cwd: root,
    detached: useProcessGroups,
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

function runDjangoMigrations() {
  console.log("[web] Applying pending Django migrations");

  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "python", "manage.py", "migrate", "--noinput"], {
      cwd: path.join(root, "backend"),
      detached: useProcessGroups,
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
            ? `Django migration was interrupted by ${signal}`
            : `Django migration exited with code ${code ?? 1}`,
        ),
      );
    });
  });
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

process.on("SIGINT", () => handleSignal("SIGINT", 130));
process.on("SIGTERM", () => handleSignal("SIGTERM", 143));

console.log("[web] Press Ctrl+C to stop both services.");

try {
  await runDjangoMigrations();
  if (!stopping) {
    console.log("[web] Starting backend at http://127.0.0.1:8787");
    console.log("[web] Starting Ticketry at http://127.0.0.1:5174");
    start("backend", "./scripts/dev.sh backend");
    start(
      "frontend",
      "npm run dev --workspace @worktracker/studio -- --host 127.0.0.1 --strictPort",
    );
  }
} catch (error) {
  if (!stopping) {
    stopping = true;
    exitCode = 1;
    console.error(`[web] Could not prepare Django: ${error.message}`);
  }
  finishIfStopped();
}
