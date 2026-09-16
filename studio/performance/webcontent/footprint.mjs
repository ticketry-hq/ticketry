/**
 * Reading `footprint --json`.
 *
 * `footprint` is the only tool on a stock macOS that splits a process's
 * physical footprint into allocator categories without root, which is what
 * separates "WebKit's allocator is holding pages" from "the window's layer
 * backing stores are large". Its own `start_time` is kept as the sample instant
 * so a sample is timestamped when it was taken, not when it was parsed.
 *
 * The unit check is not ceremony. `footprint` can report pages or formatted
 * strings depending on `--format`, and a page count read as a byte count is off
 * by a factor of 16384 while still looking like a plausible memory figure.
 */

/** Ask for raw bytes so the numbers need no interpretation. */
export function FOOTPRINT_ARGUMENTS(pid, outputPath) {
  return ["-p", String(pid), "--format", "bytes", "--json", outputPath];
}

function unavailableSample(pid, reason) {
  return { pid, at: null, footprintBytes: null, categories: {}, reason };
}

export function parseFootprintReport(report, pid) {
  if (!report || typeof report !== "object") {
    return unavailableSample(pid, "no footprint report was produced");
  }
  if (report.unit !== "byte") {
    return unavailableSample(
      pid,
      `footprint reported unit "${report.unit}" rather than bytes, so its numbers `
      + "cannot be read as byte counts",
    );
  }
  const measured = (report.processes ?? []).find((entry) => entry.pid === pid);
  if (!measured) {
    return unavailableSample(pid, `process ${pid} is not in this footprint report`);
  }
  return {
    pid,
    at: report.start_time?.date ?? null,
    footprintBytes: measured.footprint ?? null,
    pageSizeBytes: measured["page size"] ?? null,
    categories: measured.categories ?? {},
    reason: null,
  };
}
