/**
 * The shape of everything a profiling run writes to disk.
 *
 * Both the Node orchestration scripts and the Playwright scenarios import this
 * module, so artifact names and the run-metadata contract have exactly one
 * definition. Plain ESM rather than TypeScript for that reason: the `.mjs`
 * modules under `performance/report/` are the pieces both worlds share.
 */
export const REPORT_SCHEMA_VERSION = 1;

/** Artifact file names inside `<run>/scenarios/<engine>/<scenario>/`. */
export const ARTIFACTS = {
  observations: "observations.json",
  cpuProfile: "cpu.cpuprofile",
  cpuSummary: "cpu-summary.json",
  heapSamples: "heap-samples.json",
  heapSnapshotBefore: "before.heapsnapshot",
  heapSnapshotAfter: "after.heapsnapshot",
  failure: "failure.json",
};

/** Files at the root of `<run>/`. */
export const RUN_FILES = {
  metadata: "metadata.json",
  fixture: "fixture.json",
  manifest: "manifest.json",
  summaryJson: "summary.json",
  summaryMarkdown: "summary.md",
  hostLoad: "host-load.json",
  playwrightReport: "playwright-report.json",
};

/**
 * A metric that could not be measured is null with a reason. It is never zero:
 * "no long tasks happened" and "this engine has no long-task observer" are
 * different findings and must not collapse into the same number.
 */
export function unavailable(reason) {
  return { value: null, reason };
}

export function available(value) {
  return { value, reason: null };
}

export function isUnavailable(metric) {
  return metric === null || metric === undefined || metric.value === null;
}

/**
 * Run metadata. Everything here is needed to decide whether two runs may be
 * compared, and nothing here is a full environment dump.
 */
export function createRunMetadata({
  runIdentifier,
  startedAt,
  engine,
  engineVersion,
  playwrightVersion,
  nodeVersion,
  buildMode,
  adapterProfile,
  headless,
  viewport,
  dataset,
  scenarios,
  captures,
  source,
  machine,
  ports,
  dataDirectory,
  allowStaleBuild = false,
}) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    runIdentifier,
    startedAt,
    engine,
    engineVersion,
    playwrightVersion,
    nodeVersion,
    buildMode,
    adapterProfile,
    headless,
    viewport,
    dataset,
    scenarios,
    captures,
    source,
    machine,
    ports,
    dataDirectory,
    allowStaleBuild,
  };
}

/**
 * The compatibility key two runs must share before their medians may be
 * compared as a regression signal rather than as trivia.
 */
export function comparisonKey(metadata) {
  return {
    schemaVersion: metadata.schemaVersion,
    engine: metadata.engine,
    buildMode: metadata.buildMode,
    adapterProfile: metadata.adapterProfile,
    headless: metadata.headless,
    viewport: metadata.viewport,
    datasetVersion: metadata.dataset?.version ?? null,
    datasetSize: metadata.dataset?.size ?? null,
    datasetCounts: metadata.dataset?.counts ?? null,
    captures: [...(metadata.captures ?? [])].sort(),
    machineClass: {
      platform: metadata.machine?.platform ?? null,
      architecture: metadata.machine?.architecture ?? null,
      cpuModel: metadata.machine?.cpuModel ?? null,
      cpuCount: metadata.machine?.cpuCount ?? null,
      totalMemoryBytes: metadata.machine?.totalMemoryBytes ?? null,
    },
  };
}
