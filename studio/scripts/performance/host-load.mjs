import { execFileSync } from "node:child_process";
import os from "node:os";

/**
 * Host conditions around a measurement.
 *
 * A timing run competing with a Rust build or a parallel Vitest fleet is not
 * wrong, it is unrepresentative. These samples let a report say so instead of
 * silently publishing a slow median, and nothing here kills or throttles any
 * process the profiler does not own.
 */
const MAX_SAMPLES = 600;

export function sampleHostLoad({ now = () => new Date().toISOString() } = {}) {
  const [oneMinute, fiveMinute, fifteenMinute] = os.loadavg();
  return {
    at: now(),
    loadAverage: { oneMinute, fiveMinute, fifteenMinute },
    cpuCount: os.cpus().length,
    freeMemoryBytes: os.freemem(),
    totalMemoryBytes: os.totalmem(),
    memoryPressureLevel: readMacosMemoryPressureLevel(),
  };
}

/**
 * macOS reports 1 normal, 2 warning, 4 critical. Every other platform, and any
 * failure to read it, is recorded as unavailable rather than as "normal".
 */
export function readMacosMemoryPressureLevel({
  platform = process.platform,
  read = () =>
    execFileSync("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
} = {}) {
  if (platform !== "darwin") {
    return { value: null, reason: `unsupported platform ${platform}` };
  }
  try {
    const value = Number(read().trim());
    if (!Number.isFinite(value)) return { value: null, reason: "unparsable sysctl output" };
    return { value, level: { 1: "normal", 2: "warning", 4: "critical" }[value] ?? "unknown" };
  } catch (error) {
    return { value: null, reason: `sysctl failed: ${error.message}` };
  }
}

export function createHostLoadSampler({ intervalMs = 1_000, sample = sampleHostLoad } = {}) {
  const samples = [];
  let timer = null;
  const record = () => {
    if (samples.length >= MAX_SAMPLES) samples.shift();
    samples.push(sample());
  };
  return {
    start() {
      if (timer) return;
      record();
      timer = setInterval(record, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      record();
      return samples;
    },
    get samples() {
      return samples;
    },
  };
}

/**
 * A blunt, explicitly labelled noise check. It reports; it never decides that a
 * measurement is invalid, and it never touches another process.
 */
export function assessHostNoise(samples, {
  loadPerCpuLimit = 0.7,
  freeMemoryFraction = 0.1,
} = {}) {
  const reasons = [];
  if (samples.length === 0) return { noisy: false, reasons, checked: false };
  const cpuCount = samples[0].cpuCount || 1;
  const peakLoad = Math.max(...samples.map((entry) => entry.loadAverage.oneMinute));
  const loadPerCpu = peakLoad / cpuCount;
  if (loadPerCpu > loadPerCpuLimit) {
    reasons.push(
      `peak one-minute load average ${peakLoad.toFixed(2)} over ${cpuCount} CPUs `
      + `(${loadPerCpu.toFixed(2)} per CPU) exceeds ${loadPerCpuLimit} per CPU`,
    );
  }
  const lowestFree = Math.min(...samples.map((entry) => entry.freeMemoryBytes));
  const total = samples[0].totalMemoryBytes || 1;
  if (lowestFree / total < freeMemoryFraction) {
    reasons.push(
      `free memory fell to ${(lowestFree / total * 100).toFixed(1)}% of ${total} bytes`,
    );
  }
  if (samples.some((entry) => (entry.memoryPressureLevel?.value ?? 1) > 1)) {
    reasons.push("the OS reported elevated memory pressure during the run");
  }
  return { noisy: reasons.length > 0, reasons, checked: true, loadPerCpu };
}
