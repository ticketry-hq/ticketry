/**
 * The macOS side of a capture: reading processes, footprints and host state.
 *
 * Every command here is available on a stock macOS without root, which is the
 * constraint that shaped this investigation. `footprint` gives the allocator
 * category breakdown, `ps` gives launch times and CPU, and `sysctl`/`vm_stat`
 * give the host conditions that decide whether the numbers mean anything —
 * a footprint measured on a machine already deep into swap is a different
 * observation from the same figure on an idle host.
 */
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { FOOTPRINT_ARGUMENTS, parseFootprintReport } from "./footprint.mjs";
import {
  PROCESS_TABLE_ARGUMENTS,
  parseProcessTable,
  parseResourceRow,
  resourceArguments,
} from "./processTable.mjs";

const execFile = promisify(execFileCallback);

export async function readProcessTable() {
  const { stdout } = await execFile("ps", PROCESS_TABLE_ARGUMENTS);
  return parseProcessTable(stdout);
}

export async function readResources(pid) {
  try {
    const { stdout } = await execFile("ps", resourceArguments(pid));
    return parseResourceRow(stdout, pid);
  } catch {
    return parseResourceRow("", pid);
  }
}

/** `footprint` writes JSON to a file, so each sample uses a private temp dir. */
export async function readFootprint(pid) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ticketry-footprint-"));
  const reportPath = path.join(directory, "footprint.json");
  try {
    await execFile("footprint", FOOTPRINT_ARGUMENTS(pid, reportPath));
    return parseFootprintReport(JSON.parse(await readFile(reportPath, "utf8")), pid);
  } catch (error) {
    return {
      pid,
      at: null,
      footprintBytes: null,
      categories: {},
      reason: `footprint could not sample ${pid}: ${error.message}`,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Swap and page state. Recorded per sample: host pressure moves during a capture. */
export async function readHostState() {
  const [swap, vmStat] = await Promise.all([
    execFile("sysctl", ["-n", "vm.swapusage"]).then(({ stdout }) => stdout.trim()).catch(() => null),
    execFile("vm_stat").then(({ stdout }) => stdout).catch(() => null),
  ]);
  const swapUsedBytes = swap?.match(/used\s*=\s*([\d.]+)M/);
  const compressed = vmStat?.match(/Pages occupied by compressor:\s+(\d+)/);
  const pageSize = vmStat?.match(/page size of (\d+) bytes/);
  const free = vmStat?.match(/Pages free:\s+(\d+)/);
  const bytesPerPage = pageSize ? Number(pageSize[1]) : null;
  return {
    swapUsedBytes: swapUsedBytes ? Math.round(Number(swapUsedBytes[1]) * 1024 * 1024) : null,
    compressedBytes: compressed && bytesPerPage ? Number(compressed[1]) * bytesPerPage : null,
    freeBytes: free && bytesPerPage ? Number(free[1]) * bytesPerPage : null,
  };
}

export async function machineIdentity() {
  const [macOS, model] = await Promise.all([
    execFile("sw_vers", ["-productVersion"]).then(({ stdout }) => stdout.trim()),
    execFile("sysctl", ["-n", "hw.model"]).then(({ stdout }) => stdout.trim()),
  ]);
  return {
    model,
    macOS,
    architecture: os.arch(),
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  };
}

/**
 * Which artifact ran. A memory report that cannot name its binary describes
 * nothing, so the executable is hashed rather than trusted by path.
 */
export async function buildIdentity(executable) {
  if (!executable.includes(".app/Contents/MacOS/")) {
    throw new Error(`--executable must point inside a packaged macOS .app, not ${executable}`);
  }
  const bytes = await readFile(executable);
  const plist = path.resolve(executable, "..", "..", "Info.plist");
  let version = null;
  try {
    const { stdout } = await execFile(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleShortVersionString", plist],
    );
    version = stdout.trim();
  } catch {
    version = null;
  }
  return {
    executable,
    executableSha256: createHash("sha256").update(bytes).digest("hex"),
    version,
    buildMode: "packaged",
  };
}

/**
 * A microstackshot of the content process. This is what turns "memory moved"
 * into "this code ran": `sample` records call stacks without root and without
 * a debug build, which is the only stack evidence a packaged WKWebView offers.
 */
export async function recordStackSample(pid, { seconds = 10, intervalMs = 10, outputPath }) {
  await execFile(
    "sample",
    [String(pid), String(seconds), String(intervalMs), "-file", outputPath],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return outputPath;
}
