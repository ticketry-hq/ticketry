import type { ReactNode } from "react";
import type { SprintSuggestionRecordFragment } from "../generated/sprints.documents";

export function PlanDetailPane({ openItem, suggestions, busy, renderWorkItemDetail, onAccept, onDismiss, onClose }: {
  openItem: string | null;
  suggestions: SprintSuggestionRecordFragment[];
  busy: boolean;
  renderWorkItemDetail: (id: string) => ReactNode;
  onAccept: (suggestion: SprintSuggestionRecordFragment) => void;
  onDismiss: (suggestion: SprintSuggestionRecordFragment) => void;
  onClose: () => void;
}) {
  if (!openItem) return null;
  const suggestion = openItem.startsWith("suggestion:")
    ? suggestions.find((candidate) => `suggestion:${candidate.id}` === openItem) : null;
  return <aside aria-label="Selected ticket" className="flex min-h-0 min-w-0 flex-col border-l border-pane-border bg-pane-panel md:w-[38%]">
    <button type="button" aria-label="Close selected ticket" onClick={onClose}
      className="self-end px-3 py-1 text-text-muted">×</button>
    {suggestion ? <>
      <div className="border-b border-pane-border bg-focus-accent/10 p-3 text-sm">
        <p className="text-focus-accent">✦ Suggested story</p>
        <p className="text-text-secondary">{suggestion.reason}</p>
        <div className="mt-2 flex gap-3">
          <button type="button" disabled={busy} onClick={() => onAccept(suggestion)}>{suggestion.issueId ? "Add to sprint" : "Create story"}</button>
          <button type="button" disabled={busy} onClick={() => onDismiss(suggestion)}>Dismiss</button>
        </div>
      </div>
      {suggestion.issueId ? renderWorkItemDetail(suggestion.issueId)
        : <div className="p-3 text-text-primary"><h2>{suggestion.proposedName}</h2></div>}
    </> : !openItem.startsWith("suggestion:") && renderWorkItemDetail(openItem)}
  </aside>;
}
