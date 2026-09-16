import { execFileSync } from "node:child_process";

/**
 * OS-level process sampling for the desktop confirmation run.
 *
 * Attribution is the whole difficulty. A WKWebView content process is not a
 * child of the application — launchd owns it — so there is no reliable parent
 * link to follow. When the evidence does not identify exactly one candidate,
 * this module reports the webview metrics as unavailable. Picking the busiest
 * WebKit process on the machine would produce a number that reads like
 * evidence and is not.
 */
const WEBVIEW_PROCESS_NAME = "com.apple.WebKit.WebContent";
const MAX_SAMPLES = 600;

function ps(arguments_, { run = execFileSync } = {}) {
  return run("ps", arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

export function sampleProcess(pid, { run = execFileSync } = {}) {
  try {
    const output = ps(["-o", "rss=,%cpu=", "-p", String(pid)], { run }).trim();
    if (!output) return { pid, rssBytes: null, cpuPercent: null, reason: "process not found" };
    const [rssKilobytes, cpuPercent] = output.split(/\s+/);
    return {
      pid,
      rssBytes: Number(rssKilobytes) * 1024,
      cpuPercent: Number(cpuPercent),
      reason: null,
    };
  } catch (error) {
    return { pid, rssBytes: null, cpuPercent: null, reason: `ps failed: ${error.message}` };
  }
}

/**
 * Identify the webview content process, or say why it cannot be identified.
 * `sinceOnly` narrows the candidates to processes that were not already
 * running before the application started.
 */
export function resolveWebviewProcess({
  platform = process.platform,
  run = execFileSync,
  existingPids = [],
} = {}) {
  if (platform !== "darwin") {
    return { pid: null, reason: `webview process attribution is macOS-only, not ${platform}` };
  }
  let rows;
  try {
    rows = ps(["-A", "-o", "pid=,comm="], { run })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(WEBVIEW_PROCESS_NAME))
      .map((line) => Number(line.split(/\s+/)[0]))
      .filter((pid) => Number.isInteger(pid) && !existingPids.includes(pid));
  } catch (error) {
    return { pid: null, reason: `ps failed: ${error.message}` };
  }
  if (rows.length === 0) {
    return { pid: null, reason: "no new WebKit content process appeared after launch" };
  }
  if (rows.length > 1) {
    return {
      pid: null,
      reason: `${rows.length} new WebKit content processes are running, so none can be `
        + "attributed to this application with confidence",
      candidates: rows,
    };
  }
  return { pid: rows[0], reason: null, evidence: "exactly one new WebKit content process" };
}

export function listWebviewPids({ platform = process.platform, run = execFileSync } = {}) {
  if (platform !== "darwin") return [];
  try {
    return ps(["-A", "-o", "pid=,comm="], { run })
      .split("\n")
      .filter((line) => line.includes(WEBVIEW_PROCESS_NAME))
      .map((line) => Number(line.trim().split(/\s+/)[0]))
      .filter(Number.isInteger);
  } catch {
    return [];
  }
}

export function createProcessSampler({ intervalMs = 1_000, targets }) {
  const samples = [];
  let timer = null;
  const record = () => {
    if (samples.length >= MAX_SAMPLES) samples.shift();
    samples.push({
      at: new Date().toISOString(),
      processes: Object.fromEntries(
        Object.entries(targets)
          .filter(([, pid]) => Number.isInteger(pid))
          .map(([name, pid]) => [name, sampleProcess(pid)]),
      ),
    });
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
      return samples;
    },
  };
}
