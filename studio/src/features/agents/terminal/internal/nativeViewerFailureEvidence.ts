/**
 * Bounded ledger of every native viewer failure this document has seen.
 *
 * The recovery policy only ever learns a reason string. The ledger keeps what
 * that string drops — which code path failed, the native handle, and the
 * error's stack — so a Studio reload can carry full evidence of its cause.
 */

export interface NativeViewerFailureReport {
  /** The code path that observed the failure, e.g. `attach`, `frame-sync`. */
  origin: string;
  reason: string;
  handle?: string | null;
  error?: unknown;
}

export interface NativeViewerFailureEntry {
  at: string;
  runId: string;
  origin: string;
  reason: string;
  handle: string | null;
  error: { name: string; message: string; stack?: string } | string | null;
}

const MAX_ENTRIES = 50;
const entries: NativeViewerFailureEntry[] = [];

function serialiseError(error: unknown): NativeViewerFailureEntry["error"] {
  if (error === undefined || error === null) return null;
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function recordNativeViewerFailureEvidence(
  runId: string,
  report: NativeViewerFailureReport,
): void {
  entries.push({
    at: new Date().toISOString(),
    runId,
    origin: report.origin,
    reason: report.reason,
    handle: report.handle ?? null,
    error: serialiseError(report.error),
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function nativeViewerFailureEvidence(): readonly NativeViewerFailureEntry[] {
  return entries.slice();
}

/** For tests only. */
export function resetNativeViewerFailureEvidence(): void {
  entries.length = 0;
}
