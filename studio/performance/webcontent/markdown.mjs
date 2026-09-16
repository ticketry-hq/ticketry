/**
 * The human-readable half of a WebContent memory capture.
 *
 * Every number printed here carries what a second engineer needs to judge it:
 * which artifact was measured, which process the numbers were attributed to
 * and on what evidence, how many samples stand behind a median, and whether
 * sampling was continuous. A metric that could not be measured prints its
 * reason; it never prints as zero, because "we did not measure it" and "it was
 * nothing" are different findings.
 */

const BYTES_PER_MIB = 1024 ** 2;

function isPercentSeries(name) {
  return /percent$/i.test(name);
}

function mib(value) {
  if (!Number.isFinite(value)) return "—";
  return `${(value / BYTES_PER_MIB).toFixed(1)} MiB`;
}

function percent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function signed(value, format) {
  if (!Number.isFinite(value)) return "—";
  return value > 0 ? `+${format(value)}` : format(value);
}

function humanize(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function unavailableText(finding) {
  return finding?.value === null && finding?.reason
    ? `unavailable — ${finding.reason}`
    : null;
}

function fieldText(key, value) {
  if (value === null || value === undefined) return "not recorded";
  if (typeof value === "number") {
    if (/bytes$/i.test(key)) return mib(value);
    // `rangePercentOfMedian` is a percentage too; matching only a trailing
    // "Percent" printed it at raw float precision.
    if (/percent/i.test(key)) return percent(value);
    return String(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Retention and churn are findings, not fixed schemas: the summarizer decides
 * which fields it can honestly report. They render field by field, and an
 * unavailable finding prints its reason verbatim rather than an empty block.
 */
function findingLines(label, finding) {
  if (!finding) return [`- ${label}: not recorded`];
  const unavailable = unavailableText(finding);
  if (unavailable) return [`- ${label}: ${unavailable}`];
  // `value`/`reason` are the unavailability envelope; once a finding is
  // available they carry nothing a reader needs.
  const entries = Object.entries(finding).filter(
    ([key, value]) => value !== undefined && key !== "value"
      && !(key === "reason" && value === null),
  );
  if (entries.length === 0) return [`- ${label}: not recorded`];
  const lines = [`- ${label}:`];
  for (const [key, value] of entries) {
    if (key === "reason" && typeof value === "string") {
      lines.push(`  - unavailable — ${value}`);
      continue;
    }
    lines.push(`  - ${humanize(key)}: ${fieldText(key, value)}`);
  }
  return lines;
}

function seriesRow(name, summary) {
  const format = isPercentSeries(name) ? percent : mib;
  const unavailable = unavailableText(summary);
  if (unavailable) return `| ${name} | ${unavailable} | — | — | — | — | — | 0 |`;
  if (!summary || summary.count === 0) {
    return `| ${name} | ${summary?.reason ?? "no samples recorded"} `
      + "| — | — | — | — | — | 0 |";
  }
  const note = summary.quantilesApproximate ? `p95 approximate at n=${summary.count}` : "";
  return `| ${name} | ${format(summary.median)} | ${format(summary.p95)} `
    + `| ${format(summary.min)} | ${format(summary.max)} `
    + `| ${signed(summary.netChange, format)} | ${format(summary.range)} `
    + `| ${summary.count}${note ? ` (${note})` : ""} |`;
}

/**
 * How the content process was chosen. A reader must be able to check the
 * choice, so the rule, the launch offset it turned on and the processes it
 * rejected are all named rather than summarised as "attributed".
 */
function attributionLine(attribution) {
  if (!Number.isInteger(attribution?.webContentPid)) {
    return "- WebContent process: unattributed — "
      + `${attribution?.reason ?? "no reason recorded"}. `
      + "These numbers describe no identified process.";
  }
  const evidence = attribution.evidence;
  if (!evidence || typeof evidence !== "object") {
    return `- WebContent process ${attribution.webContentPid} (GUI process `
      + `${attribution.guiPid ?? "—"}): no evidence recorded`;
  }
  const parts = [evidence.rule ?? "rule not recorded"];
  if (Number.isFinite(evidence.offsetSeconds)) {
    parts.push(`started ${evidence.offsetSeconds} s after the GUI process`);
  }
  if (Number.isFinite(evidence.windowSeconds)) {
    parts.push(`launch window ${evidence.windowSeconds} s`);
  }
  if (evidence.rejectedPids?.length) {
    parts.push(`rejected content processes ${evidence.rejectedPids.join(", ")}`);
  }
  if (evidence.corroborated !== undefined) {
    parts.push(evidence.corroborated
      ? "corroborated by the launch window"
      : "not corroborated by the launch window");
  }
  return `- WebContent process ${attribution.webContentPid} (GUI process `
    + `${attribution.guiPid ?? "—"}): ${parts.join("; ")}`;
}

function discontinuityLines(discontinuities) {
  if (!discontinuities?.length) {
    return ["Sampling was continuous; no gap was recorded."];
  }
  return [
    `Sampling was interrupted ${discontinuities.length} time(s):`,
    ...discontinuities.map((entry) => {
      if (typeof entry === "string") return `- ${entry}`;
      const at = Number.isFinite(entry.atOffsetMs)
        ? `${(entry.atOffsetMs / 1000).toFixed(1)} s in`
        : "at an unrecorded time";
      return `- ${at} — ${entry.kind ?? "unrecorded break"}: `
        + `${entry.detail ?? "no detail recorded"}`;
    }),
    "",
    "A median taken across a gap describes two windows, not one.",
  ];
}

export function renderCaptureMarkdown(capture) {
  const scenario = capture.scenario ?? {};
  const build = capture.build ?? {};
  const machine = capture.machine ?? {};
  const summary = capture.summary ?? {};
  const series = Object.entries(summary.series ?? {});
  const lines = [
    `# WebContent memory capture — ${scenario.name ?? "unnamed scenario"}`,
    "",
    `- Captured: ${capture.capturedAt ?? "—"}`,
    `- Workload: ${scenario.workload ?? "—"}`,
    `- Conditions: ${scenario.visibleViewerCount ?? "—"} visible viewer(s), `
    + `${scenario.retainedViewerCount ?? "—"} retained, `
    + `${scenario.activeRunCount ?? "—"} active run(s), `
    + `${scenario.documentState ?? "document state unrecorded"}`,
    `- Sampling: ${scenario.settleSeconds ?? "—"} s settle, then `
    + `${scenario.seconds ?? "—"} s at ${scenario.intervalMs ?? "—"} ms`,
    `- Build: ${build.version ?? "—"} ${build.buildMode ?? ""} — ${build.executable ?? "—"}`,
    `- Executable SHA-256: ${build.executableSha256 ?? "unrecorded"}`,
    `- Machine: ${machine.model ?? "—"} (${machine.architecture ?? "—"}, `
    + `${machine.logicalCpuCount ?? "—"} logical CPUs, `
    + `${Number.isFinite(machine.totalMemoryBytes)
      ? `${(machine.totalMemoryBytes / 1024 ** 3).toFixed(0)} GiB RAM`
      : "RAM unrecorded"}), macOS ${machine.macOS ?? "—"}`,
    `- Instrumentation: ${capture.instrumentation?.profiler ?? "—"}`
    + `${capture.instrumentation?.diagnosticBuild ? ", diagnostic build" : ""}`,
    attributionLine(capture.attribution),
    `- Samples: ${summary.sampleCount ?? capture.samples?.length ?? 0} over `
    + `${Number.isFinite(summary.durationMs) ? (summary.durationMs / 1000).toFixed(1) : "—"} s`
    + `${summary.continuous === false ? " (interrupted)" : ""}`,
    "",
    "## Series",
    "",
    "| Series | median | p95 | min | max | net change | range | samples |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...series.map(([name, entry]) => seriesRow(name, entry)),
    "",
    "Byte series are the operating system's measurements of one process. They "
    + "are not JavaScript heap bytes and must not be added to them.",
    "",
    "## Sampling continuity",
    "",
    ...discontinuityLines(capture.discontinuities),
    "",
    "## Retention and churn",
    "",
    ...findingLines("Retention", summary.retention),
    ...findingLines("Churn", summary.churn),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function conditionRows(conditions) {
  return Object.entries(conditions ?? {}).map(([name, values]) => {
    const changed = String(values.baseline) !== String(values.candidate);
    return `| ${humanize(name)} | ${values.baseline ?? "—"} | ${values.candidate ?? "—"} `
      + `| ${changed ? "changed" : "same"} |`;
  });
}

function deltaRow(row) {
  const format = isPercentSeries(row.series) ? percent : mib;
  const note = row.quantilesApproximate ? " (p95 approximate)" : "";
  return `| ${row.series}${note} | ${format(row.baselineMedian)} `
    + `| ${format(row.candidateMedian)} | ${signed(row.deltaBytes, format)} `
    + `| ${row.deltaPercent === null ? "—" : signed(row.deltaPercent, (value) => `${value.toFixed(1)}%`)} `
    + `| ${row.baselineSamples} / ${row.candidateSamples} |`;
}

export function renderComparisonMarkdown(comparison) {
  const lines = [
    "# WebContent memory comparison",
    "",
    `- Baseline: ${comparison.baseline.scenario} — WebContent pid `
    + `${comparison.baseline.webContentPid ?? "—"}, captured ${comparison.baseline.capturedAt}`,
    `- Candidate: ${comparison.candidate.scenario} — WebContent pid `
    + `${comparison.candidate.webContentPid ?? "—"}, captured ${comparison.candidate.capturedAt}`,
    `- Compatibility: ${comparison.compatible ? "compatible" : "INCOMPATIBLE"}`,
    "",
  ];
  if (comparison.incompatibilities.length > 0) {
    lines.push(
      comparison.informational
        ? "> Informational comparison across incompatible captures. The mismatch "
          + "below is part of every delta in this report:"
        : "> Incompatible captures:",
      ...comparison.incompatibilities.map((reason) => `> - ${reason}`),
      "",
    );
  }
  lines.push(
    "## Conditions",
    "",
    "| Condition | baseline | candidate | varied |",
    "| --- | --- | --- | --- |",
    ...conditionRows(comparison.conditions),
    "",
    "## Deltas",
    "",
    "| Series | baseline median | candidate median | delta | delta % | samples |",
    "| --- | --- | --- | --- | --- | --- |",
    ...comparison.rows.map(deltaRow),
    "",
  );
  if (comparison.skipped.length > 0) {
    lines.push(
      "## Not compared",
      "",
      ...comparison.skipped.map((reason) => `- ${reason}`),
      "",
    );
  }
  lines.push(comparison.note, "");
  return `${lines.join("\n")}\n`;
}
