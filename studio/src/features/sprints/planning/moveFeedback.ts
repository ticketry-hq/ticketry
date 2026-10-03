/**
 * One PlanWorkItem write: the item and the sprint (or Backlog, `null`) it
 * leaves and enters. Every move, including Undo, uses the current eligibility.
 */
export type Move = { itemId: string; key: string; from: string | null; to: string | null };
export type MoveEligibility =
  | { kind: "eligible" }
  | { kind: "focus"; epicName: string }
  | { kind: "workflow"; stateName: string }
  | { kind: "hierarchy" }
  | { kind: "unavailable" };
/** `seen` once the graph has shown the item where its Retry or Undo expects it. */
export type Outcome = { op: number; move: Move; seen?: true };

/**
 * Plan-screen move feedback. Each write has an op number, increasing; `pending`
 * maps an item to its in-flight op. Failures keep one Retry per item; only the
 * newest success offers Undo.
 */
export type MoveFeedback = {
  pending: Record<string, Outcome>;
  failures: Outcome[];
  success: Outcome | null;
};

export type MoveEvent =
  | { type: "start"; op: number; move: Move }
  | { type: "settle"; op: number; ok: boolean }
  | { type: "dismiss"; itemId: string }
  | { type: "expire"; op: number }
  | { type: "observe"; seen: number[]; stale: number[] }
  | { type: "reset" };

export const EMPTY_FEEDBACK: MoveFeedback = { pending: {}, failures: [], success: null };

const without = (failures: Outcome[], itemId: string) => failures.filter((failure) => failure.move.itemId !== itemId);

export function moveFeedback(state: MoveFeedback, event: MoveEvent): MoveFeedback {
  switch (event.type) {
    case "start": {
      // A new action on an item supersedes its Retry and Undo.
      const { itemId } = event.move;
      return {
        pending: { ...state.pending, [itemId]: { op: event.op, move: event.move } },
        failures: without(state.failures, itemId),
        success: state.success?.move.itemId === itemId ? null : state.success,
      };
    }
    case "settle": {
      const done = Object.values(state.pending).find((outcome) => outcome.op === event.op);
      if (!done) return state;
      const { [done.move.itemId]: _, ...pending } = state.pending;
      if (!event.ok) return { ...state, pending, failures: [...without(state.failures, done.move.itemId), done] };
      const newer = state.success && state.success.op > done.op;
      return { ...state, pending, success: newer ? state.success : done };
    }
    case "dismiss":
      return { ...state, failures: without(state.failures, event.itemId) };
    case "expire":
      return state.success?.op === event.op ? { ...state, success: null } : state;
    // A sprint switch: old ops leave `pending`, so their late settles find nothing.
    case "reset":
      return EMPTY_FEEDBACK;
    case "observe": {
      // Committed, so a Retry or Undo overtaken once stays gone if the item later returns.
      const mark = (outcome: Outcome): Outcome | null =>
        event.stale.includes(outcome.op) ? null : event.seen.includes(outcome.op) ? { ...outcome, seen: true } : outcome;
      const failures = state.failures.map(mark).filter((outcome): outcome is Outcome => outcome !== null);
      return { ...state, failures, success: state.success && mark(state.success) };
    }
  }
}

/**
 * Drop Retry and Undo that an assignment made elsewhere has overtaken: a Retry
 * needs the item still where its move started, an Undo where its move ended.
 * `sprintOf` is `undefined` for an item no longer in the graph.
 */
export function liveFeedback(state: MoveFeedback, sprintOf: (itemId: string) => string | null | undefined): MoveFeedback {
  const failures = state.failures.filter(({ move }) => sprintOf(move.itemId) === move.from);
  const success = state.success && sprintOf(state.success.move.itemId) === state.success.move.to ? state.success : null;
  return failures.length === state.failures.length && success === state.success ? state : { ...state, failures, success };
}

/**
 * The `observe` event for the graph as it is now. An outcome turns `seen` when
 * its item sits where it expects, and stale when it leaves after that. Waiting
 * for `seen` keeps a failure's own rollback, which reaches the graph after the
 * failure is recorded, from counting as a move made elsewhere.
 */
export function observed(state: MoveFeedback, sprintOf: (itemId: string) => string | null | undefined) {
  const event: Extract<MoveEvent, { type: "observe" }> = { type: "observe", seen: [], stale: [] };
  const check = ({ op, move, seen }: Outcome, expected: string | null) => {
    const here = sprintOf(move.itemId) === expected;
    if (here && !seen) event.seen.push(op);
    if (!here && seen) event.stale.push(op);
  };
  for (const failure of state.failures) check(failure, failure.move.from);
  if (state.success) check(state.success, state.success.move.to);
  return event.seen.length || event.stale.length ? event : null;
}
