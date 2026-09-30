/**
 * The shape of one WebContent memory capture.
 *
 * A capture answers "what did the packaged window's WKWebView content process
 * hold, on this machine, running this artifact, under this workload". Every
 * field exists so a second engineer can decide whether two captures may be
 * compared at all. Metrics that could not be measured are `unavailable(reason)`
 * and never zero, matching the profiling harness in `performance/report/`.
 */
import { unavailable } from "../report/schema.mjs";

export const WEBCONTENT_CAPTURE_SCHEMA_VERSION = 1;
export const CAPTURE_KIND = "webcontent-memory";

/** Footprint categories a report may name. Others stay in `categories` raw. */
export const TRACKED_CATEGORIES = Object.freeze([
  "WebKit malloc",
  "JS JIT generated code",
  "JS VM Gigacage",
  "MALLOC_SMALL",
  "Owned physical footprint (unmapped) (graphics)",
]);

/** Series a summary reports, and where each is read from a sample. */
export const TRACKED_SERIES = Object.freeze({
  footprintBytes: (sample) => sample.webContent?.footprintBytes ?? null,
  webKitMallocDirtyBytes: (sample) =>
    sample.webContent?.categories?.["WebKit malloc"]?.dirty ?? null,
  webKitMallocReclaimableBytes: (sample) =>
    sample.webContent?.categories?.["WebKit malloc"]?.reclaimable ?? null,
  webContentRssBytes: (sample) => sample.webContent?.rssBytes ?? null,
  webContentCpuPercent: (sample) => sample.webContent?.cpuPercent ?? null,
  guiRssBytes: (sample) => sample.gui?.rssBytes ?? null,
  guiCpuPercent: (sample) => sample.gui?.cpuPercent ?? null,
});

/**
 * The key two captures must share before their numbers may be subtracted.
 * Scenario name and viewer counts are deliberately absent: those are the
 * dimensions a comparison exists to vary.
 */
export function captureComparisonKey(capture) {
  return {
    schemaVersion: capture.schemaVersion,
    kind: capture.kind,
    executableSha256: capture.build?.executableSha256 ?? null,
    buildMode: capture.build?.buildMode ?? null,
    diagnosticBuild: capture.instrumentation?.diagnosticBuild ?? null,
    profiler: capture.instrumentation?.profiler ?? null,
    settleSeconds: capture.scenario?.settleSeconds ?? null,
    seconds: capture.scenario?.seconds ?? null,
    intervalMs: capture.scenario?.intervalMs ?? null,
    machineClass: {
      model: capture.machine?.model ?? null,
      macOS: capture.machine?.macOS ?? null,
      architecture: capture.machine?.architecture ?? null,
      totalMemoryBytes: capture.machine?.totalMemoryBytes ?? null,
    },
  };
}

/**
 * Structural validation. It rejects a capture that cannot be read honestly —
 * no samples, an unattributed process, or fewer samples than the scenario
 * claims to have taken.
 */
export function validateCapture(capture) {
  const problems = [];
  if (capture?.schemaVersion !== WEBCONTENT_CAPTURE_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${WEBCONTENT_CAPTURE_SCHEMA_VERSION}`);
  }
  if (capture?.kind !== CAPTURE_KIND) problems.push(`kind must be ${CAPTURE_KIND}`);
  if (!capture?.scenario?.name) problems.push("scenario name is required");
  if (!capture?.scenario?.workload?.trim()) problems.push("scenario workload is required");
  if (!capture?.build?.executableSha256) problems.push("build executableSha256 is required");
  if (!capture?.machine?.macOS) problems.push("machine identity is required");
  if (!Number.isInteger(capture?.attribution?.webContentPid)) {
    problems.push("a capture without an attributed WebContent process is not evidence");
  }
  if (!Array.isArray(capture?.samples) || capture.samples.length === 0) {
    problems.push("a capture with no samples is not evidence");
  }
  return problems;
}

export function assertValidCapture(capture) {
  const problems = validateCapture(capture);
  if (problems.length > 0) {
    throw new Error(`this WebContent capture is unusable:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
  return capture;
}

export { unavailable };
