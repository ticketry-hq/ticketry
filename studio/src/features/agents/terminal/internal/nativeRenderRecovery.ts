import { reloadStudio } from "../../../../app/startup/reloadStudio";
import {
  clearNativeRenderRecoveryAttempt,
  readNativeRenderRecoveryAttempt,
  writeNativeRenderRecoveryAttempt,
} from "./nativeRenderRecoveryStore";

/**
 * The window-scoped native render recovery campaign.
 *
 * A live desktop terminal that reports the established native-viewer failure
 * keeps its compatibility renderer and schedules exactly one full Studio
 * refresh. Every mounted terminal surface reports into this one coordinator, so
 * retained viewers, competing foreground hosts, React remounts and repeated
 * failure callbacks share a single timer and a single reload.
 *
 * The campaign is keyed by run. A visible native viewer that commits a
 * non-empty grid retires only its own run's failure; the campaign clears once
 * no failing run is outstanding, so a healthy terminal cannot strand a broken
 * one on the compatibility renderer. A later unrelated incident starts again at
 * the initial delay.
 *
 * The campaign spans documents. Each refresh destroys this module along with
 * its WebView, so the attempt number lives in window-session storage and the
 * coordinator that loads in the next document resumes the same campaign with a
 * longer delay.
 */

/** The first recovery attempt's delay. */
export const INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS = 500;

/** The ceiling every attempt past the fifth settles on. */
export const MAX_NATIVE_RENDER_RECOVERY_DELAY_MS = 10_000;

/**
 * `min(10s, 500ms × 2^attempt)` — 500 ms, 1 s, 2 s, 4 s, 8 s, then 10 s
 * forever. Deterministic and jitter-free: one window runs one campaign, so
 * there is nothing to spread out and a predictable delay is testable.
 */
export function nativeRenderRecoveryDelayMs(attempt: number): number {
  const growth = INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS * 2 ** attempt;
  return Math.min(MAX_NATIVE_RENDER_RECOVERY_DELAY_MS, growth);
}

let timer: ReturnType<typeof setTimeout> | null = null;
/**
 * Identifies the campaign a scheduled reload belongs to. Clearing the campaign
 * advances it, so a timer that already expired into the task queue cannot
 * reload a terminal that has recovered in the meantime.
 */
let campaign = 0;
let reload: () => void = reloadStudio;
/**
 * The mounted terminal surfaces currently stranded on the compatibility
 * renderer, as `report token → run`. A failure report can never repeat itself:
 * the reporting effect's inputs settle once its run has failed, and that run's
 * native viewer is unmounted by then. Holding the report for as long as its
 * surface is mounted is therefore the only record that a run is still broken
 * while some other, healthy terminal presents.
 */
const failingSurfaces = new Map<number, string>();
let nextFailureToken = 0;

/** Replaces the reload boundary for tests. Returns the restore function. */
export function configureNativeRenderRecovery(overrides: {
  reload: () => void;
}): () => void {
  const previous = reload;
  reload = overrides.reload;
  return () => {
    reload = previous;
  };
}

/** True while a refresh is scheduled and not yet executed or cancelled. */
export function nativeRenderRecoveryPending(): boolean {
  return timer !== null;
}

/**
 * Drops the pending refresh and the persisted campaign without logging a
 * recovery. For tests only.
 */
export function resetNativeRenderRecovery(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  campaign += 1;
  failingSurfaces.clear();
  clearNativeRenderRecoveryAttempt();
}

/**
 * Records a concrete native-viewer failure for a live desktop terminal's run,
 * and returns the release that retires it. Callers must release when the
 * reporting surface stops showing that run's fallback — usually on unmount.
 * Releasing is not recovery: it neither cancels a booked refresh nor clears the
 * campaign, it only stops a surface that no longer exists from vouching that
 * its run is still broken.
 *
 * Callers own the desktop-runtime, native-capability and live-session gates;
 * this coordinator owns only how many refreshes one window may schedule.
 */
export function reportNativeRenderFailure(
  runId: string,
  reason: string,
): () => void {
  const token = (nextFailureToken += 1);
  failingSurfaces.set(token, runId);
  const release = () => {
    failingSurfaces.delete(token);
  };
  const attempt = readNativeRenderRecoveryAttempt();
  if (timer !== null) {
    // One actual reload consumes one attempt: a repeat report while the
    // refresh is already booked neither re-arms the timer nor advances it.
    console.info("native render recovery already scheduled", {
      runId,
      reason,
      attempt,
    });
    return release;
  }
  const delayMs = nativeRenderRecoveryDelayMs(attempt);
  const scheduled = campaign;
  console.warn("native render recovery scheduled", {
    runId,
    reason,
    attempt,
    delayMs,
  });
  timer = setTimeout(() => {
    if (scheduled !== campaign) return;
    timer = null;
    campaign += 1;
    // Persist before refreshing: the document that comes back has to see the
    // grown attempt, and a reload boundary that throws still consumed one.
    writeNativeRenderRecoveryAttempt(attempt + 1);
    console.warn("native render recovery refreshing studio", { attempt });
    reload();
  }, delayMs);
  return release;
}

/**
 * Records a visible native viewer whose presentation committed a non-empty
 * grid for its run. Idempotent: repeated success reports after the campaign is
 * clear are silent no-ops.
 *
 * Success retires this run's outstanding failures. While another terminal is
 * still stranded on the fallback the campaign stands: that terminal cannot
 * report itself again, so cancelling here would leave it on the compatibility
 * renderer for the life of the window. Holding the campaign is also what keeps
 * the backoff honest across the unload window — a success arriving after
 * `reload()` was called must not reset the next document to 500 ms.
 *
 * With nothing outstanding, success clears the persisted attempt even with no
 * timer pending, because the document that recovers is usually the one a
 * previous refresh produced.
 */
export function reportNativeRenderSuccess(runId: string): void {
  for (const [token, failing] of failingSurfaces) {
    if (failing === runId) failingSurfaces.delete(token);
  }
  if (failingSurfaces.size > 0) {
    console.info("native render recovery kept for still-failing terminals", {
      runId,
      outstanding: failingSurfaces.size,
    });
    return;
  }
  const pending = timer !== null;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
    campaign += 1;
  }
  const carried = readNativeRenderRecoveryAttempt();
  if (!pending && carried === 0) return;
  clearNativeRenderRecoveryAttempt();
  console.info("native render recovery cancelled by native presentation", {
    runId,
  });
}
