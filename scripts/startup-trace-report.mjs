const tracePattern = /(startup\.timeline|\] timeline|\[startup-trace\]) (\{.*\})$/;
const sourceByMarker = { "startup.timeline": "launcher", "] timeline": "desktop", "[startup-trace]": "frontend" };

export function parseStartupTraceRecords(lines) {
  return lines.flatMap((line) => {
    const match = line.match(tracePattern);
    if (!match) return [];
    // Frontend lines reach the log without a timestamp; their elapsed_ms is what matters.
    const parsedTimestamp = Date.parse(line.slice(0, line.indexOf(" ")));
    const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : null;
    try {
      const record = JSON.parse(match[2]);
      if (
        typeof record.startup_id !== "string"
        || typeof record.stage !== "string"
        || !Number.isFinite(record.elapsed_ms)
        || !Number.isFinite(record.duration_ms)
      ) return [];
      return [{ ...record, source: sourceByMarker[match[1]], timestamp }];
    } catch {
      return [];
    }
  });
}

export function latestStartupTrace(records) {
  const latestId = records.findLast((record) => record.stage === "launcher-started")?.startup_id
    ?? records.at(-1)?.startup_id;
  return latestId ? records.filter((record) => record.startup_id === latestId) : [];
}

export function renderStartupTraceReport(records) {
  if (records.length === 0) return "No desktop startup timeline found. Launch with npm run desktop:dev first.";
  const trace = latestStartupTrace(records);
  const renderRows = (records) => records.map((record) => (
    `${String(record.elapsed_ms).padStart(7)} ms  +${String(record.duration_ms).padStart(6)} ms  ${record.stage}`
  ));
  const report = [`Desktop startup trace ${trace[0].startup_id}`, ...renderRows(trace)];
  const frontendId = records.findLast((record) => record.source === "frontend")?.startup_id;
  if (frontendId) {
    const frontend = records.filter((record) => record.startup_id === frontendId);
    report.push("", `Frontend startup trace ${frontendId}`, ...renderRows(frontend));
  }
  return report.join("\n");
}
