import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Ways to end one Ticketry process, and the helper processes a scenario's
 * provider spawned. Each targets an explicit PID, never Ticketry by name, so
 * another Ticketry installation on the machine is untouched.
 */
export async function waitForExit(child, description) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

export async function quitOrderly(child) {
  // NSRunningApplication targets this PID without quitting another Ticketry installation.
  execFileSync("/usr/bin/osascript", ["-l", "JavaScript", "-e",
    `ObjC.import('AppKit'); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${child.pid}).terminate;`]);
  await waitForExit(child, "orderly desktop exit");
}

export async function killHard(child) {
  child.kill("SIGKILL");
  await waitForExit(child, "sigkill desktop exit");
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function commandLine(pid) {
  const result = spawnSync("/bin/ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}

// Only PIDs whose command line still names this installation are signalled,
// so a recorded PID the system has since reused is never touched.
export async function terminateHelperProcesses(pids, { installationRoot }) {
  const live = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0
    && alive(pid) && commandLine(pid).includes(installationRoot));
  for (const pid of live) process.kill(pid, "SIGTERM");
  for (let attempt = 0; attempt < 20 && live.some(alive); attempt++) await delay(100);
  for (const pid of live.filter(alive)) process.kill(pid, "SIGKILL");
}
