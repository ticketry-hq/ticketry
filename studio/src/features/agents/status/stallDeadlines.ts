import { useAgentStatusStore } from "./store";
import { stallDeadlineAt } from "./runPresentation";
import type { AgentStatusData } from "./types";

/**
 * The single owner of the unchanged-output deadline, keyed by durable run.
 *
 * The backend snapshot is authoritative for the effective state at read time;
 * this coordinator only makes a *connected* UI change at the boundary without
 * waiting for another server message, and without a per-run database write or
 * a fabricated lifecycle event when nothing but time has passed.
 *
 * It holds one timer for the nearest pending deadline rather than one per run,
 * so project switches, run removal, and terminal outcomes dispose obsolete
 * timers simply by no longer contributing a deadline.
 */

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

function nextDeadline(data: AgentStatusData, now: number): number | null {
  let soonest: number | null = null;
  for (const run of Object.values(data.runs)) {
    const due = stallDeadlineAt(run);
    // A run already past its deadline is projected as stalled by every reader;
    // scheduling for it would only wake the app up to change nothing.
    if (due === null || due <= now) continue;
    if (soonest === null || due < soonest) soonest = due;
  }
  return soonest;
}

function reschedule(data: AgentStatusData): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const now = Date.now();
  const due = nextDeadline(data, now);
  if (due === null) return;
  timer = setTimeout(() => {
    timer = null;
    // Nothing about the run changed — only the clock. Advancing the epoch
    // republishes the holding so every reader reprojects from the same facts.
    useAgentStatusStore.getState().advanceStallEpoch();
  }, due - now);
}

/** Begin coordinating deadlines for the status holding. Idempotent. */
export function startStallDeadlines(): void {
  if (unsubscribe) return;
  unsubscribe = useAgentStatusStore.subscribe(reschedule);
  reschedule(useAgentStatusStore.getState());
}

/** Stop coordinating and drop any pending deadline. */
export function stopStallDeadlines(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
