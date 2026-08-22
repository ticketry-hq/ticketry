import type { RunRecord, RunPresentationState } from "./types";

/**
 * The one projection from a run's persisted facts to what Studio renders.
 *
 * Terminal tabs, work-item aggregate status, and module counts all read this,
 * so the same run cannot be `Stalled` on one surface and `Working` on another.
 *
 * The Studio mirror of `project_effective_state` in
 * `backend/studio_server/contracts.py`. Kept free of React, the store, and any
 * timer so the boundary is unit-testable on its own.
 */

/** Fixed for this release: unchanged output for this long presents as stalled. */
export const STALL_AFTER_MS = 60_000;

/**
 * States that already record what actually happened to the run. Runtime truth
 * outranks the inactivity heuristic, so these are never overlaid.
 */
const TERMINAL_STATES: ReadonlySet<string> = new Set(["exited", "lost", "error"]);

/**
 * States in which the run is waiting on the person at the keyboard. They
 * already explain the silence, so the inactivity heuristic has nothing to add.
 */
const AWAITING_USER_STATES: ReadonlySet<string> = new Set([
  "needs_input",
  "permission_required",
]);

/**
 * Whether this state records what actually happened to the run: an explicit
 * termination or confirmed hosted-command exit (`exited`), the authoritative
 * missing-session outcome (`lost`), or a recorded failure (`error`).
 *
 * The one definition of the precedence rule. The projection below, the
 * deadline coordinator, and the status holding all ask this question, so a run
 * that reached an outcome cannot be overlaid or rewound by one of them while
 * another still treats it as live.
 */
export function isTerminalOutcome(state: string): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Whether this state says the run is waiting on the user rather than producing
 * work: an agent that asked a question (`needs_input`) or one whose next step
 * is a pending permission decision (`permission_required`).
 *
 * These are exempt from the inactivity overlay. A waiting terminal produces no
 * output by definition, so overlaying it would replace an attention signal
 * with an idle one sixty seconds after the agent asked — and never restore it,
 * because only changed output clears `stalled` and a waiting terminal has none
 * to give. `stalled` exists to stop a run looking active without evidence;
 * these states already state, from the provider itself, why the terminal is
 * quiet.
 */
export function isAwaitingUser(state: string): boolean {
  return AWAITING_USER_STATES.has(state);
}

/**
 * When this run would begin presenting as stalled, or `null` when the overlay
 * cannot apply to it. Drives deadline scheduling; the projection below decides
 * what is actually rendered.
 */
export function stallDeadlineAt(run: RunRecord): number | null {
  if (isTerminalOutcome(run.state) || isAwaitingUser(run.state)) return null;
  if (!run.last_output_at) return null;
  const observed = Date.parse(run.last_output_at);
  if (Number.isNaN(observed)) return null;
  return observed + STALL_AFTER_MS;
}

/**
 * Project one run's effective presentation at a moment in time.
 *
 * Precedence, in order: a terminal outcome is authoritative; a run waiting on
 * the user keeps that attention state; otherwise a live run whose terminal
 * output has not changed for {@link STALL_AFTER_MS} presents as `stalled`;
 * otherwise the latest provider lifecycle state is presented. The boundary is
 * inclusive, and changed output restores the provider-derived state
 * immediately rather than manufacturing `working`.
 */
export function projectRunPresentation(
  run: RunRecord,
  now: number = Date.now(),
): RunPresentationState {
  if (isTerminalOutcome(run.state) || isAwaitingUser(run.state)) return run.state;
  if (run.effective_state === "stalled") return "stalled";
  const deadline = stallDeadlineAt(run);
  if (deadline !== null && now >= deadline) return "stalled";
  return run.state;
}
