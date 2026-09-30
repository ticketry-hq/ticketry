import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * One profiling run at a time per checkout.
 *
 * Two concurrent runs would share ports, the prepared bundle and, worse, the
 * machine whose CPU they are trying to measure. The lock records the owning
 * process so a crashed run cannot block the next one forever.
 */
export function acquireRunLock({
  lockPath,
  runIdentifier,
  pid = process.pid,
  isRunning = processIsRunning,
  now = () => new Date().toISOString(),
}) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const record = JSON.stringify({ pid, runIdentifier, acquiredAt: now() }, null, 2);
  try {
    writeFileSync(lockPath, record, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const holder = readLock(lockPath);
    if (holder && isRunning(holder.pid)) {
      throw new Error(
        `another profiling run is active in this checkout `
        + `(pid ${holder.pid}, run ${holder.runIdentifier}, started ${holder.acquiredAt}). `
        + `Wait for it to finish, or remove ${lockPath} if that process is gone.`,
      );
    }
    // The previous owner died without releasing. Take the lock over rather
    // than making the user delete a file by hand.
    writeFileSync(lockPath, record);
  }
  let released = false;
  return {
    lockPath,
    release() {
      if (released) return;
      released = true;
      rmSync(lockPath, { force: true });
    },
  };
}

function readLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

export function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
