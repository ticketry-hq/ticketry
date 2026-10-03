import { useCallback, useEffect, useRef, useState } from "react";


import { createApolloStore } from "../../../shared/apollo/localState";
import { usePlanWorkItem, usePlanWritePending } from "../../work-items";
import { EMPTY_FEEDBACK, liveFeedback, moveFeedback, observed, type Move, type MoveEligibility } from "./moveFeedback";

const useMoveFeedback = createApolloStore("plan-move-feedback", () => EMPTY_FEEDBACK);
const UNDO_MS = 5000;
const NOT_HELD = { focus: false, hover: false };

/**
 * Plan stories in or out of the sprint through PlanWorkItem, one write per
 * item at a time. Apollo moves the row optimistically and reverts it on
 * failure; the in-flight guard is shared with every other view of the same
 * client (see work-items' planWriteGuard), so reopening Plan or using the
 * story panel can't send a second write. This keeps only the Retry and Undo
 * feedback for the Plan visit.
 * `sprintOf` reads an item's current assignment, so stale Retry and Undo drop,
 * and stay dropped even if the item returns.
 * `eligibility` is the screen's current rule and reason for every move; every write
 * checks it at action time, so Retry and Undo follow the
 * same backlog eligibility and focus as the buttons.
 */
export function usePlanMoves(
  sprintOf: (itemId: string) => string | null | undefined,
  eligibility: (move: Move) => MoveEligibility,
) {
  // Plan's failure entry carries the item, destination and Retry, so no global notice.
  const plan = usePlanWorkItem();
  const planPending = usePlanWritePending();
  useMoveFeedback.getState();
  const state = useMoveFeedback();
  const dispatch = useCallback((event: Parameters<typeof moveFeedback>[1]) => {
    useMoveFeedback.setState((current) => moveFeedback(current, event), true);
  }, []);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; dispatch({ type: "reset" }); return () => { mounted.current = false; dispatch({ type: "reset" }); }; }, [dispatch]);
  const lastOp = useRef(0);
  const feedback = liveFeedback(state, sprintOf);
  const allowed = (next: Move) => eligibility(next).kind === "eligible";
  const done = feedback.success;
  const undoEligibility = done
    ? eligibility({ ...done.move, from: done.move.to, to: done.move.from })
    : { kind: "unavailable" } satisfies MoveEligibility;
  const allowedNow = useRef(allowed);
  allowedNow.current = allowed;
  useEffect(() => {
    const event = observed(state, sprintOf);
    if (event) dispatch(event);
  });

  // Undo's timer pauses while the button has focus or the pointer, and resumes
  // with what was left (WCAG 2.2.1). The effect's cleanup also clears it on unmount.
  const undoOp = state.success?.op;
  const [held, setHeld] = useState(NOT_HELD);
  const paused = undoEligibility.kind === "eligible" && (held.focus || held.hover);
  useEffect(() => {
    if (undoEligibility.kind !== "eligible") setHeld(NOT_HELD);
  }, [undoEligibility.kind]);
  const left = useRef({ op: -1, ms: UNDO_MS });
  useEffect(() => {
    // A removed button fires no blur or mouseleave, so drop its holds with it.
    if (undoOp === undefined) return setHeld(NOT_HELD);
    if (left.current.op !== undoOp) left.current = { op: undoOp, ms: UNDO_MS };
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dispatch({ type: "expire", op: undoOp }), left.current.ms);
    return () => {
      window.clearTimeout(timer);
      left.current.ms -= Date.now() - started;
    };
  }, [undoOp, paused]);

  const move = useCallback(
    async (next: Move) => {
      // The shared guard is synchronous, so a double click or a drop racing a click can't send twice.
      if (planPending(next.itemId) || !allowedNow.current(next)) return;
      const op = ++lastOp.current;
      dispatch({ type: "start", op, move: next });
      const ok = Boolean(await plan(next.itemId, next.to));
      // After unmount this dispatch goes nowhere, so a late result can't reach another visit.
      if (mounted.current) dispatch({ type: "settle", op, ok });
    },
    [plan, planPending],
  );

  const retry = (itemId: string) => {
    const failure = feedback.failures.find((candidate) => candidate.move.itemId === itemId);
    if (failure) void move(failure.move);
  };
  const undo = () => {
    const done = feedback.success;
    if (done) void move({ ...done.move, from: done.move.to, to: done.move.from });
  };

  return {
    move,
    retry,
    undo,
    feedback,
    eligibility,
    undoEligibility,
    isPending: (itemId: string) => itemId in state.pending || planPending(itemId),
    dismiss: (itemId: string) => dispatch({ type: "dismiss", itemId }),
    holdUndo: (reason: keyof typeof NOT_HELD, on: boolean) =>
      setHeld((now) => ({ ...now, [reason]: on && undoEligibility.kind === "eligible" })),
    // Clearing `success` also clears the Undo timer through its effect.
    reset: () => dispatch({ type: "reset" }),
  };
}
