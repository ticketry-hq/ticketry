/**
 * Reading macOS `ps` output.
 *
 * Attribution needs launch times, so the table is read with `lstart` rather
 * than the elapsed-time column: `lstart` is an absolute instant and survives a
 * capture that starts long after the application did. A row `ps` did not format
 * as expected is skipped rather than parsed into NaN, because a NaN launch time
 * silently satisfies every window comparison.
 */
const ROW = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/;

/** `ps -Ao pid=,ppid=,lstart=,comm=` */
export const PROCESS_TABLE_ARGUMENTS = ["-Ao", "pid=,ppid=,lstart=,comm="];

/** `ps -o rss=,%cpu= -p <pid>` */
export function resourceArguments(pid) {
  return ["-o", "rss=,%cpu=", "-p", String(pid)];
}

export function parseProcessTable(output) {
  return String(output).split("\n").flatMap((line) => {
    const match = line.match(ROW);
    if (!match) return [];
    const startedAtMs = Date.parse(match[3].replace(/\s+/g, " "));
    if (!Number.isFinite(startedAtMs)) return [];
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      startedAtMs,
      command: match[4].trim(),
    }];
  });
}

export function parseResourceRow(output, pid) {
  const trimmed = String(output).trim();
  if (!trimmed) {
    return {
      pid,
      rssBytes: null,
      cpuPercent: null,
      reason: `process ${pid} is no longer running`,
    };
  }
  const [rssKibibytes, cpuPercent] = trimmed.split(/\s+/);
  return {
    pid,
    rssBytes: Number(rssKibibytes) * 1024,
    cpuPercent: Number(cpuPercent),
    reason: null,
  };
}
