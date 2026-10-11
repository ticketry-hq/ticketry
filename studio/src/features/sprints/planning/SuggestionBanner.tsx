import type { SprintSuggestionRecordFragment } from "../generated/sprints.documents";
import { focusKeyboardDecision } from "./useRemovalFocus";

export function SuggestionBanner({ suggestion, goals, busy, acceptDisabled = false, dismissDisabled = false, onAccept, onDismiss }: {
  suggestion: SprintSuggestionRecordFragment;
  goals: readonly { id: string; text: string; position: number }[];
  busy: boolean;
  acceptDisabled?: boolean;
  dismissDisabled?: boolean;
  onAccept: (suggestion: SprintSuggestionRecordFragment) => void;
  onDismiss: (suggestion: SprintSuggestionRecordFragment) => void;
}) {
  const goal = goals.find((goal) => goal.id === suggestion.goalId);
  return <div role="note" className="border-b border-pane-border bg-focus-accent/10 p-3 text-sm">
    <p className="text-focus-accent">✦ Suggested by the agent</p>
    {goal && <p className="mt-1 text-focus-accent">G{goal.position}. {goal.text}</p>}
    <p className="text-text-secondary">{suggestion.reason}</p>
    <div className="mt-2 flex gap-3">
      <button type="button" disabled={busy || acceptDisabled} onClick={(event) => { focusKeyboardDecision(event); onAccept(suggestion); }}>{suggestion.issueId ? "Add to sprint" : "Create story"}</button>
      <button type="button" disabled={busy || dismissDisabled} onClick={(event) => { focusKeyboardDecision(event); onDismiss(suggestion); }}>Dismiss</button>
    </div>
  </div>;
}
