/**
 * The human-readable half of a run's report.
 *
 * Everything printed here is qualified: quantile convention and sample count
 * travel with each timing row, unavailable metrics print their reason instead
 * of a number, and no metric name implies a browser-standard measurement the
 * harness did not actually take.
 */
import { QUANTILE_CONVENTION } from "./summarize.mjs";

function milliseconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} ms` : "—";
}

function timingRow(name, summary) {
  if (!summary || summary.count === 0) {
    return `| ${name} | — | — | — | 0 | ${summary?.reason ?? "not recorded"} |`;
  }
  const note = summary.quantilesApproximate
    ? `p95 approximate at n=${summary.count}`
    : "";
  return `| ${name} | ${milliseconds(summary.median)} | ${milliseconds(summary.p95)} `
    + `| ${milliseconds(summary.max)} | ${summary.count} | ${note} |`;
}

/**
 * Probe metrics render as a short line, not as a JSON dump: a hundred raw
 * Event Timing entries in a report body hide the one number that matters. The
 * full payload stays in `summary.json`.
 */
function metricLine(label, metric, describe) {
  if (metric === null || metric === undefined) return `- ${label}: not recorded`;
  if (metric.value === null) {
    return `- ${label}: unavailable — ${metric.reason ?? "no reason recorded"}`;
  }
  return `- ${label}: ${describe(metric.value)}`;
}

function probeLines(probes) {
  const lines = [
    "Browser probes:",
    metricLine(
      "long tasks",
      probes.longTasks,
      (value) => `${value.count} tasks, ${value.totalMs.toFixed(1)} ms total, `
        + `${value.maxMs.toFixed(1)} ms longest`,
    ),
    metricLine(
      "event timing (not INP)",
      probes.eventTiming,
      (value) => `${value.count} entries over the 16 ms threshold, `
        + `${value.maxDurationMs} ms longest`,
    ),
    metricLine(
      "layout shift",
      probes.layoutShift,
      (value) => `${value.count} shifts, ${value.totalScore.toFixed(4)} total score`,
    ),
    metricLine(
      "timer scheduling delay",
      probes.schedulingDelay,
      (value) => value.distribution
        ? `${value.distribution.count} samples at ${value.intervalMs} ms — `
          + `p50 ${value.distribution.p50.toFixed(1)} ms, `
          + `p95 ${value.distribution.p95.toFixed(1)} ms, `
          + `max ${value.distribution.max.toFixed(1)} ms`
        : "no samples in this window",
    ),
    metricLine(
      "JS heap (performance.memory, quantized)",
      probes.memory,
      (value) => `${(value.usedJSHeapSize / 1024 ** 2).toFixed(1)} MiB used of `
        + `${(value.totalJSHeapSize / 1024 ** 2).toFixed(1)} MiB`,
    ),
  ];
  if (probes.domNodeCounts) {
    lines.push(
      `- DOM nodes at window boundaries: ${probes.domNodeCounts.before} → `
      + `${probes.domNodeCounts.after}`,
    );
  }
  if (probes.renderer) {
    lines.push(metricLine(
      "terminal renderer counters",
      probes.renderer,
      (value) => JSON.stringify(value),
    ));
  }
  return lines;
}

function scenarioSection(scenario) {
  const lines = [
    `### ${scenario.scenario} (${scenario.engine})`,
    "",
    `Status: ${scenario.status}. Repetitions: ${scenario.repetitions ?? "—"} `
    + `(warmups: ${scenario.warmups ?? "—"}).`,
    "",
  ];
  const timings = Object.entries(scenario.timings ?? {});
  if (timings.length > 0) {
    lines.push(
      "| Timing | median | p95 | max | samples | note |",
      "| --- | --- | --- | --- | --- | --- |",
      ...timings.map(([name, summary]) => timingRow(name, summary)),
      "",
      "End-to-end automation latency: runner action dispatch to asserted ready "
      + "state, measured on Node's monotonic clock. It includes Playwright "
      + "dispatch and assertion overhead and is neither INP nor paint latency.",
      "",
    );
  }
  if (scenario.probes) lines.push(...probeLines(scenario.probes), "");
  for (const [windowName, window] of Object.entries(scenario.operations ?? {})) {
    const busiest = Object.entries(window.operations)
      .sort((left, right) => right[1].count - left[1].count)
      .slice(0, 8)
      .map(([name, entry]) => `${name}×${entry.count}`)
      .join(", ");
    lines.push(
      `GraphQL and HTTP requests (${windowName}): ${window.totalOperations}`
      + `${busiest ? ` — ${busiest}` : ""}`,
    );
  }
  if (scenario.pageErrors) {
    // Totals across setup and the measured window. A setup error describes the
    // fixture, not the measurement, which is why it is reported here rather
    // than failing the scenario.
    lines.push("", `Page errors (setup and measured): ${JSON.stringify(scenario.pageErrors)}`);
  }
  // Only scenarios that record batches say anything about retention; every
  // other one stays silent rather than printing a line about a measurement it
  // was never meant to take.
  if (scenario.retention?.batchCount === undefined && scenario.retention?.reason
    && !scenario.retention.reason.includes("no retention batches")) {
    lines.push("", `Retention: unavailable — ${scenario.retention.reason}`);
  } else if (scenario.retention?.batchCount) {
    lines.push(
      "",
      `Retention across ${scenario.retention.batchCount} batches — `
      + `heap growth ${scenario.retention.heapGrowthBytes} bytes `
      + `(${scenario.retention.heapGrowthBytesAfterWarmup} after warmup), `
      + `DOM growth ${scenario.retention.domGrowth} nodes.`,
      scenario.retention.interpretation,
    );
  }
  if (scenario.failures?.length) {
    lines.push("", "Failures:", ...scenario.failures.map((entry) => `- ${entry}`));
  }
  lines.push("");
  return lines;
}

function cpuFrameRow(frame) {
  return `| ${frame.selfTimeUs} | ${frame.selfPercent?.toFixed(1) ?? "—"} `
    + `| ${frame.functionName} | ${
      frame.unresolved
        ? "(unresolved)"
        : `${frame.url}:${frame.lineNumber}:${frame.columnNumber}`
    } |`;
}

/**
 * Where the attributed time went by script origin. In a headless run the
 * automation driver shares the renderer, so this table is the first thing to
 * read: it says how much of the profile is the application at all.
 */
function cpuOriginLines(cpu) {
  if (!cpu.origins?.length) return [];
  return [
    "| attributed self µs | self % | script origin |",
    "| --- | --- | --- |",
    ...cpu.origins.map((entry) =>
      `| ${entry.selfTimeUs} | ${entry.selfPercent?.toFixed(1) ?? "—"} | ${entry.origin} |`
    ),
    "",
    cpu.attributionNote ?? "",
    "",
  ];
}

function cpuApplicationLines(cpu) {
  if (!cpu.applicationFrames) return [];
  if (cpu.applicationFrames.length === 0) {
    return ["No frame in this profile resolved to a script URL.", ""];
  }
  return [
    "Application and other resolved script frames:",
    "",
    "| self µs | self % | function | script |",
    "| --- | --- | --- | --- |",
    ...cpu.applicationFrames.slice(0, 15).map(cpuFrameRow),
    "",
  ];
}

function cpuSection(cpu) {
  if (!cpu) return [];
  if (cpu.value === null && cpu.reason) {
    return [`### CPU profile (${cpu.scenario})`, "", `Unavailable — ${cpu.reason}`, ""];
  }
  return [
    `### CPU profile (${cpu.scenario})`,
    "",
    `${cpu.sampleCount} samples, ${cpu.attributedUs} µs attributed. ${cpu.timeBasis}.`,
    "",
    "| self µs | self % | function | script |",
    "| --- | --- | --- | --- |",
    ...cpu.frames.slice(0, 15).map(cpuFrameRow),
    "",
    "Renderer sampling only. These are not machine-wide CPU percentages, and "
    + "an unresolved frame stays unresolved rather than being attributed to a "
    + "nearby script.",
    "",
    "Function names here are the optimized bundle's, because the profile "
    + "records what the engine executed. To read them as Ticketry source, serve "
    + "the same bundle on the same origin the profile names and import "
    + "`cpu.cpuprofile` in Chrome DevTools, which then resolves the "
    + "`.map` files sitting beside the assets:",
    "",
    "```sh",
    "npx --prefix studio -- vite preview --config vite.performance.config.ts --port 4273",
    "```",
    "",
    ...cpuOriginLines(cpu),
    ...cpuApplicationLines(cpu),
  ];
}

export function renderRunMarkdown({ metadata, scenarios, cpuSummaries = [], hostLoad }) {
  const lines = [
    `# Ticketry frontend profiling run ${metadata.runIdentifier}`,
    "",
    `- Started: ${metadata.startedAt}`,
    `- Engine: ${metadata.engine} ${metadata.engineVersion ?? "(version unrecorded)"} `
    + `(${metadata.headless ? "headless" : "headed"}, `
    + `${metadata.viewport.width}x${metadata.viewport.height})`,
    `- Build: ${metadata.buildMode}, adapter profile ${metadata.adapterProfile}`,
    `- Source: ${metadata.source.gitSha}${metadata.source.dirty ? " (dirty worktree)" : ""}, `
    + `fingerprint ${metadata.source.sourceFingerprint.slice(0, 12)}`,
    `- Dataset: ${metadata.dataset.size} v${metadata.dataset.version} — `
    + `${JSON.stringify(metadata.dataset.counts)}`,
    `- Machine: ${metadata.machine.platform}/${metadata.machine.architecture}, `
    + `${metadata.machine.cpuCount}x ${metadata.machine.cpuModel}, `
    + `${(metadata.machine.totalMemoryBytes / 1024 ** 3).toFixed(1)} GiB RAM`,
    `- Node ${metadata.nodeVersion}, Playwright ${metadata.playwrightVersion}`,
    `- Captures: ${metadata.captures.length ? metadata.captures.join(", ") : "none"}`,
    `- Quantile convention: ${QUANTILE_CONVENTION}`,
    "",
  ];
  if (metadata.allowStaleBuild) {
    lines.push(
      "> This run was started with --allow-stale-build. The measured bundle may "
      + "not match the working tree.",
      "",
    );
  }
  if (hostLoad?.noise?.noisy) {
    lines.push(
      "> Noisy host during this run. Treat the timings as indicative only:",
      ...hostLoad.noise.reasons.map((reason) => `> - ${reason}`),
      "",
    );
  }
  lines.push("## Scenarios", "");
  for (const scenario of scenarios) lines.push(...scenarioSection(scenario));
  if (cpuSummaries.length > 0) {
    lines.push("## Diagnostic captures", "");
    for (const cpu of cpuSummaries) lines.push(...cpuSection(cpu));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The desktop confirmation's report. It shares the scenario rendering with the
 * browser runs and adds the two things only the desktop run can say: process
 * footprint on this machine, and why no JavaScript profile exists for it.
 */
export function renderDesktopMarkdown({ metadata, scenarios }) {
  const samples = metadata.processMetrics?.samples ?? [];
  const peak = (role) => samples
    .map((sample) => sample.processes?.[role]?.rssBytes)
    .filter((value) => Number.isFinite(value))
    .reduce((highest, value) => Math.max(highest, value), 0);
  const lines = [
    `# Ticketry desktop confirmation ${metadata.runIdentifier}`,
    "",
    `- Started: ${metadata.startedAt}`,
    `- Surface: ${metadata.surface}`,
    `- Build: ${metadata.buildMode} (${(metadata.buildMs / 1000).toFixed(1)} s)`,
    `- Source: ${metadata.source.gitSha}${metadata.source.dirty ? " (dirty worktree)" : ""}, `
    + `fingerprint ${metadata.source.sourceFingerprint.slice(0, 12)}`,
    `- Dataset: ${metadata.dataset.size} v${metadata.dataset.version}`,
    `- Machine: ${metadata.machine.platform}/${metadata.machine.architecture}, `
    + `${metadata.machine.cpuCount}x ${metadata.machine.cpuModel}`,
    `- Quantile convention: ${QUANTILE_CONVENTION}`,
    "",
    "> This run is a confirmation on the shipping surface, not a substitute for "
    + "the browser runs. It measures the installed macOS WKWebView, so its "
    + "numbers are not comparable to a headless Chromium or Playwright WebKit "
    + "run.",
    "",
    "## Scenarios",
    "",
  ];
  for (const scenario of scenarios) lines.push(...scenarioSection(scenario));
  lines.push(
    "## Reading these numbers",
    "",
    "- WebKit lists neither `longtask` nor `layout-shift`, so main-thread "
    + "blocking cannot be attributed here at all. The scheduling-delay probe is "
    + "the only event-loop signal this surface offers.",
    "- A large scheduling delay in a desktop window is not evidence of "
    + "application work. WebKit throttles timers in windows it considers "
    + "non-foreground, and an automated run leaves the window unfocused; a "
    + "100 ms timer settling to roughly one tick per second is the signature of "
    + "that throttling, not of a blocked main thread. Confirm any suspected "
    + "blocking by hand, in a focused window, before acting on it.",
    "- Timings here are automation latency measured on Node's clock across a "
    + "WebDriver hop, which is a longer path than the browser runs use.",
    "",
    "## Process footprint",
    "",
    `- Ticketry process ${metadata.processMetrics?.app?.pid ?? "—"}: peak resident `
    + `${(peak("app") / 1024 ** 2).toFixed(1)} MiB over ${samples.length} samples`,
    metadata.processMetrics?.webview?.pid
      ? `- WebKit content process ${metadata.processMetrics.webview.pid}: peak resident `
        + `${(peak("webview") / 1024 ** 2).toFixed(1)} MiB `
        + `(${metadata.processMetrics.webview.evidence})`
      : `- WebKit content process: unattributed — ${
        metadata.processMetrics?.webview?.reason ?? "no reason recorded"}`,
    "",
    metadata.processMetrics?.note ?? "",
    "",
    "Resident size is an operating-system measurement. It must not be added to "
    + "JS heap bytes, and it is not the application's memory usage on its own.",
    "",
    "## JavaScript profiling",
    "",
    `Unavailable — ${metadata.javascriptProfiling?.reason ?? "no reason recorded"}`,
    "",
  );
  return `${lines.join("\n")}\n`;
}

export function renderComparisonMarkdown(comparison) {
  const lines = [
    "# Ticketry frontend profiling comparison",
    "",
    `- Baseline: ${comparison.baseline.runIdentifier}`,
    `- Candidate: ${comparison.candidate.runIdentifier}`,
    `- Compatibility: ${comparison.compatible ? "compatible" : "INCOMPATIBLE"}`,
    "",
  ];
  if (comparison.incompatibilities.length > 0) {
    lines.push(
      comparison.informational
        ? "> Informational comparison across incompatible runs:"
        : "> Incompatible:",
      ...comparison.incompatibilities.map((reason) => `> - ${reason}`),
      "",
    );
  }
  lines.push(
    "| Scenario | Timing | baseline median | candidate median | delta | delta % |",
    "| --- | --- | --- | --- | --- | --- |",
    ...comparison.rows.map((row) =>
      `| ${row.scenario} | ${row.timing} | ${milliseconds(row.baselineMedian)} `
      + `| ${milliseconds(row.candidateMedian)} | ${milliseconds(row.deltaMs)} `
      + `| ${row.deltaPercent === null ? "—" : `${row.deltaPercent.toFixed(1)}%`} |`
    ),
    "",
    "Independent-run medians. Establish local variance across at least three "
    + "runs before reading any single delta as a regression; this command "
    + "applies no pass or fail threshold.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
