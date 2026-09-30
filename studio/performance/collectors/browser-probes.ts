/**
 * Typed access to the shared in-page probes.
 *
 * The implementation lives in `browser-probes.mjs` because two very different
 * drivers need the identical source: Playwright serializes the installer
 * function into an init script, and the desktop WebDriver harness — plain
 * Node ESM — evaluates the same text through `browser.execute`. This file adds
 * the types the Playwright side wants without forking the implementation.
 */
export {
  installPerformanceProbes,
  performanceProbeSource,
  PERFORMANCE_PROBE_GLOBAL,
  SCHEDULING_DELAY_INTERVAL_MS,
} from "./browser-probes.mjs";

/** A capability-detected metric: a value, or null with the reason it is absent. */
export interface ProbeMetric<T> {
  value: T | null;
  reason: string | null;
}

export interface ProbeSnapshot {
  label: string;
  durationMs: number;
  longTasks: ProbeMetric<{
    count: number;
    totalMs: number;
    maxMs: number;
    entries: { startTime: number; duration: number; name: string }[];
  }>;
  eventTiming: ProbeMetric<{
    count: number;
    maxDurationMs: number;
    entries: { name: string; startTime: number; duration: number }[];
    note: string;
  }>;
  layoutShift: ProbeMetric<{ count: number; totalScore: number }>;
  schedulingDelay: ProbeMetric<{
    intervalMs: number;
    count: number;
    maxMs: number;
    droppedSamples: number;
    distribution: {
      count: number;
      min: number;
      p50: number;
      p95: number;
      max: number;
    } | null;
    note: string;
  }>;
  memory: ProbeMetric<{
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  }>;
  marks: { name: string; at: number }[];
  errors: { pageErrors: number; consoleErrors: number; messages: string[] };
}
