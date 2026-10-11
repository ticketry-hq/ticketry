import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { freemem, homedir, platform, totalmem } from "node:os";
import { join } from "node:path";

/**
 * Machine-wide admission for browser e2e stacks (adapter, Vite, Playwright and
 * Chromium). Every runner, worktree and agent of this user shares one slot
 * directory, so concurrent suites queue instead of pushing the machine into swap.
 */
export const defaultSlotDirectory = join(homedir(), ".cache", "ticketry", "e2e-stack-slots");
// One stack peaked at 0.9-1.1 GB resident (Chromium ~0.55, Vite ~0.35, adapter ~0.3,
// Playwright ~0.15) when measured on 2026-10-12.
const defaultStackMemoryMb = 1200;
const defaultMemoryFloorMb = 2048;
// A stack allocates over its first minute; until then its budget counts as used.
const reservationMs = 60_000;
// A recycled PID must not keep a dead holder's slot forever.
const maximumSlotAgeMs = 3 * 60 * 60 * 1000;
const admissionLockStaleMs = 10_000;

function nonNegativeInteger(environment, name, fallback) {
  const value = environment[name];
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  return Number(value);
}

export function stackSlotPolicy(environment = process.env, totalMb = totalmem() / 1048576) {
  const maxStacks = nonNegativeInteger(environment, "TICKETRY_E2E_MAX_STACKS", Math.max(1, Math.floor(totalMb / 6144)));
  if (maxStacks < 1) throw new Error("TICKETRY_E2E_MAX_STACKS must be at least 1");
  return {
    directory: environment.TICKETRY_E2E_SLOT_DIR || defaultSlotDirectory,
    maxStacks,
    stackMemoryMb: nonNegativeInteger(environment, "TICKETRY_E2E_STACK_MEMORY_MB", defaultStackMemoryMb),
    memoryFloorMb: nonNegativeInteger(environment, "TICKETRY_E2E_MEMORY_FLOOR_MB", defaultMemoryFloorMb),
  };
}

/** Memory the kernel considers available; macOS `freemem()` omits reclaimable cache. */
export function availableMemoryMb({ run = execFileSync, os = platform() } = {}) {
  try {
    if (os === "darwin") {
      const [level, bytes] = run("sysctl", ["-n", "kern.memorystatus_level", "hw.memsize"], { encoding: "utf8" })
        .trim().split(/\s+/).map(Number);
      if (Number.isFinite(level) && Number.isFinite(bytes)) return Math.round((level / 100) * bytes / 1048576);
    }
    if (os === "linux") {
      const match = readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+) kB/m);
      if (match) return Math.round(Number(match[1]) / 1024);
    }
  } catch {
    // Fall through to the portable, pessimistic figure.
  }
  return Math.round(freemem() / 1048576);
}

export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function removeIfPresent(path) {
  try { unlinkSync(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

/** Live holders only; dead or ancient records are reclaimed as they are read. */
export function liveSlots(directory, { isAlive = processAlive, now = Date.now } = {}) {
  const slots = [];
  for (const name of readdirSync(directory)) {
    if (!/^slot-[\w-]+\.json$/.test(name)) continue;
    const path = join(directory, name);
    let record;
    try { record = JSON.parse(readFileSync(path, "utf8")); }
    catch (error) {
      if (error.code === "ENOENT") continue;
      removeIfPresent(path);
      continue;
    }
    if (!Number.isSafeInteger(record.pid) || !isAlive(record.pid) || now() - record.admittedAt > maximumSlotAgeMs) {
      removeIfPresent(path);
      continue;
    }
    slots.push({ ...record, path });
  }
  return slots;
}

/** Runs `decide` while holding the directory's admission lock, or returns null when busy. */
function withAdmissionLock(directory, { isAlive, now, pid }, decide) {
  const lock = join(directory, "admission.lock");
  try {
    writeFileSync(lock, JSON.stringify({ pid }), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      const holder = JSON.parse(readFileSync(lock, "utf8"));
      if (!isAlive(holder.pid) || now() - statSync(lock).mtimeMs > admissionLockStaleMs) removeIfPresent(lock);
    } catch (readError) {
      if (readError.code !== "ENOENT") removeIfPresent(lock);
    }
    return null;
  }
  try { return decide(); } finally { removeIfPresent(lock); }
}

export function admissionDecision({ live, availableMb, policy, now }) {
  const reservedMb = live.filter((slot) => now - slot.admittedAt < reservationMs).length * policy.stackMemoryMb;
  const headroomMb = availableMb - reservedMb - policy.stackMemoryMb;
  // With no other stack running, waiting cannot free memory, so one stack always proceeds.
  const admitted = live.length < policy.maxStacks && (live.length === 0 || headroomMb >= policy.memoryFloorMb);
  return { admitted, held: live.length, maxStacks: policy.maxStacks, availableMb, reservedMb, headroomMb,
    memoryFloorMb: policy.memoryFloorMb, owners: live.map((slot) => slot.owner) };
}

const heldSlots = new Set();
let exitCleanupInstalled = false;
function releaseOnExit(path) {
  heldSlots.add(path);
  if (exitCleanupInstalled) return;
  exitCleanupInstalled = true;
  process.once("exit", () => { for (const held of heldSlots) removeIfPresent(held); });
}

/**
 * Waits until the machine can afford another stack and records this process as
 * its holder. The returned handle must be released when the stack stops.
 */
export async function acquireStackSlot({
  owner,
  policy = stackSlotPolicy(),
  readMemory = availableMemoryMb,
  isAlive = processAlive,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollMs = 1000,
  pid = process.pid,
  onWait = () => {},
  shouldStop = () => false,
} = {}) {
  mkdirSync(policy.directory, { recursive: true });
  for (;;) {
    if (shouldStop()) throw new Error("Stopped while waiting for an e2e stack slot");
    const decision = withAdmissionLock(policy.directory, { isAlive, now, pid }, () => {
      const result = admissionDecision({
        live: liveSlots(policy.directory, { isAlive, now }), availableMb: readMemory(), policy, now: now(),
      });
      if (!result.admitted) return result;
      const path = join(policy.directory, `slot-${randomUUID()}.json`);
      writeFileSync(path, JSON.stringify({ pid, owner, admittedAt: now() }), { flag: "wx" });
      return { ...result, path };
    });
    if (decision?.path) {
      releaseOnExit(decision.path);
      return {
        path: decision.path,
        release() {
          heldSlots.delete(decision.path);
          removeIfPresent(decision.path);
        },
      };
    }
    if (decision) onWait(decision);
    await sleep(pollMs);
  }
}

/** Prints the first wait and then at most every `intervalMs`, so queues stay legible. */
export function slotWaitReporter(label, { intervalMs = 15_000, now = Date.now, write = (line) => console.error(line) } = {}) {
  let last = -Infinity;
  return (decision) => {
    if (now() - last < intervalMs) return;
    last = now();
    const reason = decision.held >= decision.maxStacks
      ? `${decision.held}/${decision.maxStacks} e2e stacks running`
      : `another stack would leave ${decision.headroomMb} MB of the ${decision.memoryFloorMb} MB memory floor`;
    write(`[e2e-queue] ${label} waiting: ${reason}${decision.owners.length ? ` (held by: ${decision.owners.join("; ")})` : ""}`);
  };
}
