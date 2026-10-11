import type { SprintSuggestionRecordFragment } from "../generated/sprints.documents";
import { focusKeyboardDecision, nextSuggestionFocus, useRemovalFocus } from "./useRemovalFocus";

type SuggestionRowsProps = {
  suggestions: SprintSuggestionRecordFragment[];
  goals: { id: string; text: string; position: number }[];
  openItem: string | null;
  busy: boolean;
  acceptDisabled?: boolean;
  dismissDisabled?: boolean;
  onOpen: (suggestion: SprintSuggestionRecordFragment) => void;
  onAccept: (suggestion: SprintSuggestionRecordFragment) => void;
  onDismiss: (suggestion: SprintSuggestionRecordFragment) => void;
  onAcceptAll?: () => void;
};

export function SuggestionRows(props: SuggestionRowsProps) {
  return props.suggestions.length ? <SuggestionList {...props} /> : null;
}

function SuggestionList({ suggestions, goals, openItem, busy, acceptDisabled = false, dismissDisabled = false, onOpen, onAccept, onDismiss, onAcceptAll }: SuggestionRowsProps) {
  const container = useRemovalFocus<HTMLDivElement>((element) => element.closest("section")?.querySelector("h2") ?? null);
  return <div ref={container} className="border-b border-pane-border pb-2" aria-label="Suggested stories">
    <div className="flex items-center justify-between px-3 py-2 text-xs text-focus-accent">
      <span>✦ {suggestions.length} to review</span>
      {onAcceptAll && <button type="button" disabled={busy || acceptDisabled} onClick={(event) => { focusKeyboardDecision(event); onAcceptAll(); }} className="disabled:opacity-40">Add all</button>}
    </div>
    {suggestions.map((suggestion) => <SuggestionRow key={suggestion.id} suggestion={suggestion}
      goals={goals} openItem={openItem} busy={busy} acceptDisabled={acceptDisabled} dismissDisabled={dismissDisabled} onOpen={onOpen} onAccept={onAccept} onDismiss={onDismiss} />)}
  </div>;
}

function SuggestionRow({ suggestion, goals, openItem, busy, acceptDisabled, dismissDisabled, onOpen, onAccept, onDismiss }: {
  suggestion: SprintSuggestionRecordFragment;
} & Pick<SuggestionRowsProps, "goals" | "openItem" | "busy" | "acceptDisabled" | "dismissDisabled" | "onOpen" | "onAccept" | "onDismiss">) {
  const row = useRemovalFocus<HTMLDivElement>(nextSuggestionFocus);
  const goal = goals.find((goal) => goal.id === suggestion.goalId);
  const name = suggestion.issue?.name ?? suggestion.proposedName ?? "Proposed story";
  const selected = openItem === `suggestion:${suggestion.id}`;
  return <div ref={row} data-plan-suggestion={suggestion.id} role="button" tabIndex={0} aria-label={`✦ ${name}`} aria-pressed={selected}
    onClick={() => onOpen(suggestion)} onKeyDown={(event) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      event.stopPropagation();
      onOpen(suggestion);
    }}
    className={`cursor-pointer px-3 py-2 outline-none focus-visible:ring-1 focus-visible:ring-focus-accent ${selected ? "bg-focus-accent/10" : "hover:bg-pane-title"}`}>
    <div className="flex items-start gap-2">
      <span className="min-w-0 flex-1 text-left text-sm text-text-primary">
        ✦ {name}
      </span>
      <button type="button" disabled={busy || acceptDisabled} aria-label={`Accept ${suggestion.issue?.name ?? suggestion.proposedName ?? "proposal"}`}
        onClick={(event) => { event.stopPropagation(); focusKeyboardDecision(event); onAccept(suggestion); }} className="text-xs text-focus-accent disabled:opacity-40">{suggestion.issueId ? "✓ Add" : "✓ Create"}</button>
      <button type="button" disabled={busy || dismissDisabled} aria-label={`Dismiss ${suggestion.issue?.name ?? suggestion.proposedName ?? "proposal"}`}
        onClick={(event) => { event.stopPropagation(); focusKeyboardDecision(event); onDismiss(suggestion); }} className="text-xs text-text-muted disabled:opacity-40">×</button>
    </div>
    {goal && <span title={goal.text} className="mr-2 text-xs text-focus-accent">G{goal.position}</span>}
    <span className="text-xs text-text-muted">{suggestion.reason}</span>
  </div>;
}
