import type { Move, MoveEligibility, MoveFeedback } from "./moveFeedback";

const action = "font-semibold text-focus-accent hover:underline";

// The Plan screen's live region: one Retry per failed item, then the latest
// success with its Undo. `place` names a destination ("Sprint 1", "the Backlog").
// Unavailable Retry and Undo explain the current filter or planning exclusion;
// Dismiss still clears a failure.
export function PlanFeedback({
  feedback,
  place,
  eligibility,
  undoEligibility,
  onRetry,
  onDismiss,
  onUndo,
  onHoldUndo,
}: {
  feedback: MoveFeedback;
  place: (sprintId: string | null) => string;
  eligibility: (move: Move) => MoveEligibility;
  undoEligibility: MoveEligibility;
  onRetry: (itemId: string) => void;
  onDismiss: (itemId: string) => void;
  onUndo: () => void;
  onHoldUndo: (reason: "focus" | "hover", on: boolean) => void;
}) {
  const { failures, success } = feedback;
  const canUndo = undoEligibility.kind === "eligible";
  return (
    <div
      role="status"
      data-testid="plan-feedback"
      className="absolute bottom-full left-1/2 z-10 mb-2 flex -translate-x-1/2 flex-col items-center gap-1.5"
    >
      {failures.map(({ move }) => {
        const available = eligibility(move);
        const ready = available.kind === "eligible";
        return (
          <div
            key={move.itemId}
            data-testid={`plan-failure-${move.key}`}
            className={toast}
          >
            <span>
              Couldn't move {move.key} to {place(move.to)}
            </span>
            {!ready && (
              <span
                id={`plan-retry-hint-${move.key}`}
                data-testid={`plan-retry-hint-${move.key}`}
                className="min-w-0 break-words text-text-muted"
              >
                {recoveryHint(available, "retry")}
              </span>
            )}
            <button
              type="button"
              disabled={!ready}
              aria-label={`Retry moving ${move.key} to ${place(move.to)}`}
              aria-describedby={
                ready ? undefined : `plan-retry-hint-${move.key}`
              }
              data-testid={`plan-retry-${move.key}`}
              onClick={() => onRetry(move.itemId)}
              className={`${action} disabled:text-text-muted disabled:no-underline`}
            >
              Retry
            </button>
            <button
              type="button"
              aria-label={`Dismiss ${move.key} failure`}
              data-testid={`plan-dismiss-${move.key}`}
              onClick={() => onDismiss(move.itemId)}
              className="text-text-muted hover:text-text-primary"
            >
              ×
            </button>
          </div>
        );
      })}
      {success && (
        <div data-testid="plan-toast" className={toast}>
          <span>
            {success.move.key}{" "}
            {success.move.to
              ? `planned into ${place(success.move.to)}`
              : "returned to the Backlog"}
          </span>
          {!canUndo && (
            <span id="plan-undo-hint" data-testid="plan-undo-hint" className="min-w-0 break-words text-text-muted">
              {recoveryHint(undoEligibility, "undo")}
            </span>
          )}
          <button
            type="button"
            disabled={!canUndo}
            aria-label={`Undo ${success.move.key} move`}
            aria-describedby={canUndo ? undefined : "plan-undo-hint"}
            data-testid="plan-undo"
            onClick={onUndo}
            onFocus={() => onHoldUndo("focus", true)}
            onBlur={() => onHoldUndo("focus", false)}
            onMouseEnter={() => onHoldUndo("hover", true)}
            onMouseLeave={() => onHoldUndo("hover", false)}
            className={`${action} disabled:text-text-muted disabled:no-underline`}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

function recoveryHint(eligibility: MoveEligibility, action: "retry" | "undo"): string {
  switch (eligibility.kind) {
    case "eligible": return "";
    case "focus": return `Focus ${eligibility.epicName} to show this Story in the Backlog and ${action}.`;
    case "workflow": return `This Story is in ${eligibility.stateName}, outside the planning Backlog. Epic focus cannot make it eligible for ${action}.`;
    case "hierarchy": return `Nested Stories are outside the planning Backlog. Epic focus cannot make this Story eligible for ${action}.`;
    case "unavailable": return `This Story is unavailable for ${action}.`;
    default: {
      const exhaustive: never = eligibility;
      return exhaustive;
    }
  }
}

const toast =
  "flex w-max max-w-[calc(100vw-2rem)] flex-wrap items-center gap-3 border border-pane-border bg-pane-title px-3 py-2 text-sm text-text-primary shadow-lg";
