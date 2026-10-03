import type { SprintSuggestionRecordFragment } from "../generated/sprints.documents";

export function SuggestionRows({ suggestions, goals, openItem, busy, onOpen, onAccept, onDismiss }: {
  suggestions: SprintSuggestionRecordFragment[];
  goals: { id: string; text: string }[];
  openItem: string | null;
  busy: boolean;
  onOpen: (suggestion: SprintSuggestionRecordFragment) => void;
  onAccept: (suggestion: SprintSuggestionRecordFragment) => void;
  onDismiss: (suggestion: SprintSuggestionRecordFragment) => void;
}) {
  if (suggestions.length === 0) return null;
  return <div className="border-b border-pane-border pb-2" aria-label="Suggested stories">
    <div className="flex items-center justify-between px-3 py-2 text-xs text-focus-accent">
      <span>✦ {suggestions.length} to review</span>
    </div>
    {suggestions.map((suggestion) => {
      const goalIndex = goals.findIndex((goal) => goal.id === suggestion.goalId);
      return <div key={suggestion.id} className={`px-3 py-2 ${openItem === `suggestion:${suggestion.id}` ? "bg-focus-accent/10" : "hover:bg-pane-title"}`}>
        <div className="flex items-start gap-2">
          <button type="button" onClick={() => onOpen(suggestion)} className="min-w-0 flex-1 text-left text-sm text-text-primary">
            ✦ {suggestion.issue?.name ?? suggestion.proposedName ?? "Proposed story"}
          </button>
          <button type="button" disabled={busy} aria-label={`Accept ${suggestion.issue?.name ?? suggestion.proposedName ?? "proposal"}`}
            onClick={() => onAccept(suggestion)} className="text-xs text-focus-accent">{suggestion.issueId ? "✓ Add" : "✓ Create"}</button>
          <button type="button" disabled={busy} aria-label={`Dismiss ${suggestion.issue?.name ?? suggestion.proposedName ?? "proposal"}`}
            onClick={() => onDismiss(suggestion)} className="text-xs text-text-muted">×</button>
        </div>
        {goalIndex >= 0 && <span title={goals[goalIndex].text} className="mr-2 text-xs text-focus-accent">G{goalIndex + 1}</span>}
        <span className="text-xs text-text-muted">{suggestion.reason}</span>
      </div>;
    })}
  </div>;
}
