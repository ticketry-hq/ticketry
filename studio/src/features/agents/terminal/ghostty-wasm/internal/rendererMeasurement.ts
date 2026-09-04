/**
 * CODING-1304 — renderer comparison measurements.
 *
 * The experiment's deliverable is evidence, so every renderer records the same
 * counters through the same seam: attach latency, painted frames, paint
 * duration and bytes parsed. Measurements are collected in the Studio process
 * and read back by `scripts/renderer-comparison-report.mjs`, so the numbers
 * come from Ticketry's own WebView rather than a standalone browser.
 */
import type { TerminalRendererChoice } from "../rendererSelection";

export interface RendererSampleSummary {
  renderer: TerminalRendererChoice;
  runId: string;
  /** Attach request to first painted frame, in milliseconds. */
  coldAttachMs: number | null;
  /** Return from a retained hidden state to first paint, in milliseconds. */
  warmAttachMs: number | null;
  frames: number;
  bytes: number;
  paintMsTotal: number;
  paintMsMax: number;
  paintMsP50: number;
  paintMsP95: number;
  /** WebAssembly linear memory in bytes; null for renderers without one. */
  wasmMemoryBytes: number | null;
}

interface Sample {
  renderer: TerminalRendererChoice;
  runId: string;
  attachStartedAt: number | null;
  coldAttachMs: number | null;
  warmAttachMs: number | null;
  frames: number;
  bytes: number;
  paintDurations: number[];
  wasmMemoryBytes: number | null;
}

/** Cap retained durations so a long-running terminal cannot grow without bound. */
const MAX_RETAINED_DURATIONS = 2_000;

const samples = new Map<string, Sample>();

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function key(renderer: TerminalRendererChoice, runId: string): string {
  return `${renderer}:${runId}`;
}

function sample(renderer: TerminalRendererChoice, runId: string): Sample {
  const id = key(renderer, runId);
  let existing = samples.get(id);
  if (!existing) {
    existing = {
      renderer,
      runId,
      attachStartedAt: null,
      coldAttachMs: null,
      warmAttachMs: null,
      frames: 0,
      bytes: 0,
      paintDurations: [],
      wasmMemoryBytes: null,
    };
    samples.set(id, existing);
  }
  return existing;
}

/** A renderer began attaching or presenting a retained viewer. */
export function recordAttachStart(
  renderer: TerminalRendererChoice,
  runId: string,
  kind: "cold" | "warm" = "cold",
): void {
  const entry = sample(renderer, runId);
  entry.attachStartedAt = now();
  if (kind === "warm") entry.warmAttachMs = null;
}

/** The renderer put the first pixels of this attach on screen. */
export function recordFirstPaint(
  renderer: TerminalRendererChoice,
  runId: string,
  kind: "cold" | "warm" = "cold",
): void {
  const entry = sample(renderer, runId);
  if (entry.attachStartedAt === null) return;
  const elapsed = now() - entry.attachStartedAt;
  entry.attachStartedAt = null;
  if (kind === "warm") entry.warmAttachMs = elapsed;
  else if (entry.coldAttachMs === null) entry.coldAttachMs = elapsed;
}

export function recordBytes(
  renderer: TerminalRendererChoice,
  runId: string,
  count: number,
): void {
  sample(renderer, runId).bytes += count;
}

export function recordPaint(
  renderer: TerminalRendererChoice,
  runId: string,
  durationMs: number,
): void {
  const entry = sample(renderer, runId);
  entry.frames += 1;
  if (entry.paintDurations.length >= MAX_RETAINED_DURATIONS) entry.paintDurations.shift();
  entry.paintDurations.push(durationMs);
}

export function recordWasmMemory(runId: string, bytes: number): void {
  sample("ghostty-wasm", runId).wasmMemoryBytes = bytes;
}

/** Time one paint and record it. */
export function measurePaint<T>(
  renderer: TerminalRendererChoice,
  runId: string,
  paint: () => T,
): T {
  const started = now();
  try {
    return paint();
  } finally {
    recordPaint(renderer, runId, now() - started);
  }
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

/** A plain snapshot of every sample, newest counters included. */
export function rendererMeasurements(): RendererSampleSummary[] {
  return Array.from(samples.values()).map((entry) => {
    const sorted = [...entry.paintDurations].sort((a, b) => a - b);
    return {
      renderer: entry.renderer,
      runId: entry.runId,
      coldAttachMs: entry.coldAttachMs,
      warmAttachMs: entry.warmAttachMs,
      frames: entry.frames,
      bytes: entry.bytes,
      paintMsTotal: sorted.reduce((total, value) => total + value, 0),
      paintMsMax: sorted.length ? sorted[sorted.length - 1] : 0,
      paintMsP50: percentile(sorted, 0.5),
      paintMsP95: percentile(sorted, 0.95),
      wasmMemoryBytes: entry.wasmMemoryBytes,
    };
  });
}

export function resetRendererMeasurements(): void {
  samples.clear();
}

/**
 * Expose the snapshot on `window` so the comparison driver can read it out of
 * a live Studio window without a new IPC command or GraphQL field.
 */
export const RENDERER_MEASUREMENT_GLOBAL = "__ticketryRendererMeasurements";

export function publishRendererMeasurements(): void {
  if (typeof window === "undefined") return;
  (window as unknown as Record<string, unknown>)[RENDERER_MEASUREMENT_GLOBAL] =
    rendererMeasurements;
}
