/**
 * Turning one WebContent memory capture into the numbers a report may state.
 *
 * Three rules run through this module.
 *
 * A metric that was not measured stays `{value: null, reason}` and never
 * becomes zero, matching `performance/report/summarize.mjs`.
 *
 * Sustained growth and oscillation are separate findings. Retention is the net
 * distance between the first and last sample; churn is how far the series
 * travelled in between. A process can churn 250 MB and retain nothing, and it
 * can retain 170 MB while barely churning. Reporting one number for both is how
 * an allocator's working set gets mistaken for a leak.
 *
 * Retention is refused outright once the capture records a discontinuity. If
 * the content process restarted, the first and last samples belong to two
 * different processes and subtracting them measures nothing.
 */
import {
  APPROXIMATE_QUANTILE_SAMPLE_LIMIT,
  QUANTILE_CONVENTION,
  quantile,
} from "../report/summarize.mjs";
import { TRACKED_SERIES, unavailable } from "./schema.mjs";

/** Units for the tracked series, so a percent is never printed as bytes. */
const SERIES_UNITS = Object.freeze({
  footprintBytes: "bytes",
  webKitMallocDirtyBytes: "bytes",
  webKitMallocReclaimableBytes: "bytes",
  webContentRssBytes: "bytes",
  webContentCpuPercent: "percent",
  guiRssBytes: "bytes",
  guiCpuPercent: "percent",
});

const RETENTION_BASIS = "footprintBytes";

/**
 * The correction the originating ticket needs: `dirty - reclaimable` was
 * reported there as a live heap size. It is not one, and the module says so
 * rather than leaving the inference available to the next reader.
 */
export const impliedLiveIsNotAMeasurement =
  "Subtracting reclaimable from dirty gives an implied live figure, and that "
  + "figure is arithmetic on the allocator's own bookkeeping, not a measured "
  + "live JavaScript heap. Dirty and reclaimable both describe pages bmalloc "
  + "holds from the OS: dirty is what it has touched, reclaimable is the part "
  + "it has already freed internally and could hand back. Their difference "
  + "bounds what the allocator is still holding for someone; it does not say "
  + "who holds it, and it counts allocator metadata, fragmentation and "
  + "not-yet-collected garbage as though they were live objects. A live heap "
  + "size comes from a heap snapshot or the JavaScriptCore heap statistics, "
  + "never from this subtraction.";

const INTERPRETATION =
  "A large reclaimable figure means pages the allocator has already freed but "
  + "has not yet returned to the OS, so they still count against the process "
  + "footprint while belonging to nothing. The footprint range is an "
  + "allocation activity signal — how much the process allocated and released "
  + "during the window — rather than a measure of live data. Neither figure is "
  + "a measured live JavaScript heap size, and neither becomes one by "
  + "subtraction; see impliedLiveIsNotAMeasurement.";

const RESTART_REASON =
  "the content process restarted during the capture, so first and last samples "
  + "are different processes";

const CHURN_ACROSS_RESTART_NOTE =
  "this range spans a content-process restart: part of the swing is the old "
  + "process going away and a new one warming up, not one process churning";

/**
 * One numeric series. Reports position (min/median/p95/max/mean), endpoints
 * (first/last/netChange) and travel (range) as distinct facts.
 */
export function summarizeSeries(values, { unit = "bytes" } = {}) {
  const finite = (values ?? []).filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return {
      ...unavailable("no samples were recorded"),
      count: 0,
      unit,
    };
  }
  const total = finite.reduce((sum, value) => sum + value, 0);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const first = finite[0];
  const last = finite[finite.length - 1];
  return {
    value: null,
    reason: null,
    unit,
    count: finite.length,
    min,
    median: quantile(finite, 0.5),
    p95: quantile(finite, 0.95),
    max,
    mean: total / finite.length,
    first,
    last,
    netChange: last - first,
    range: max - min,
    quantileConvention: QUANTILE_CONVENTION,
    quantilesApproximate: finite.length < APPROXIMATE_QUANTILE_SAMPLE_LIMIT,
    monotonicNonDecreasing:
      finite.length >= 2
      && finite.every((value, index) => index === 0 || value >= finite[index - 1]),
  };
}

/** One capture becomes one report section. */
export function summarizeWebContentCapture(capture) {
  const samples = Array.isArray(capture?.samples) ? capture.samples : [];
  const discontinuities = Array.isArray(capture?.discontinuities)
    ? capture.discontinuities
    : [];
  const continuous = discontinuities.length === 0;

  const series = {};
  for (const [name, read] of Object.entries(TRACKED_SERIES)) {
    series[name] = summarizeSeries(samples.map((sample) => read(sample)), {
      unit: SERIES_UNITS[name] ?? "bytes",
    });
  }

  const footprint = series[RETENTION_BASIS];

  return {
    sampleCount: samples.length,
    durationMs: summarizeDuration(samples),
    continuous,
    discontinuityCount: discontinuities.length,
    series,
    retention: summarizeRetention(footprint, continuous),
    churn: summarizeChurn(footprint, continuous),
    interpretation: INTERPRETATION,
  };
}

function summarizeDuration(samples) {
  if (samples.length < 2) {
    return unavailable("a duration needs at least two samples");
  }
  const first = samples[0]?.offsetMs;
  const last = samples[samples.length - 1]?.offsetMs;
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return unavailable("the first and last samples carry no offset");
  }
  return last - first;
}

/**
 * Sustained growth across the window. Refused when the process changed
 * underneath the samples: joining across a restart is the one error this
 * report must not make.
 */
function summarizeRetention(footprint, continuous) {
  if (!continuous) {
    return { ...unavailable(RESTART_REASON), basis: RETENTION_BASIS };
  }
  if (footprint.value === null && footprint.reason !== null) {
    return { ...unavailable(footprint.reason), basis: RETENTION_BASIS };
  }
  if (footprint.count < 2) {
    return {
      ...unavailable("retention needs at least two samples of the footprint series"),
      basis: RETENTION_BASIS,
    };
  }
  return {
    value: null,
    reason: null,
    basis: RETENTION_BASIS,
    unit: footprint.unit,
    sampleCount: footprint.count,
    firstBytes: footprint.first,
    lastBytes: footprint.last,
    netChangeBytes: footprint.netChange,
    netChangePercent: footprint.first > 0
      ? (footprint.netChange / footprint.first) * 100
      : null,
    monotonic: footprint.monotonicNonDecreasing,
    interpretation:
      "net change between the first and last sample of one process. Sustained "
      + "growth is a lead, not a leak: a warming allocator also grows.",
  };
}

/**
 * Oscillation within the window. Still reportable across a discontinuity — the
 * swing happened — but carries a note saying part of it is the restart.
 */
function summarizeChurn(footprint, continuous) {
  if (footprint.value === null && footprint.reason !== null) {
    return {
      ...unavailable(footprint.reason),
      basis: RETENTION_BASIS,
      spansRestart: !continuous,
    };
  }
  return {
    value: null,
    reason: null,
    basis: RETENTION_BASIS,
    unit: footprint.unit,
    sampleCount: footprint.count,
    minBytes: footprint.min,
    maxBytes: footprint.max,
    rangeBytes: footprint.range,
    rangePercentOfMedian: footprint.median > 0
      ? (footprint.range / footprint.median) * 100
      : null,
    spansRestart: !continuous,
    note: continuous ? null : CHURN_ACROSS_RESTART_NOTE,
    interpretation:
      "how far the footprint travelled during the window. This is allocation "
      + "activity, not retained data, and it says nothing on its own about a leak.",
  };
}
