import type { SprintSuggestionRecordFragment } from "../generated/sprints.documents";

export function AcceptedSuggestionGoals({ itemId, suggestions, goals }: {
  itemId: string;
  suggestions: readonly SprintSuggestionRecordFragment[];
  goals: readonly { id: string; text: string; position: number }[];
}) {
  const accepted = new Set(suggestions
    .filter((suggestion) => suggestion.status === "accepted" && suggestion.issueId === itemId)
    .map((suggestion) => suggestion.goalId));
  return <>{goals.map((goal) => accepted.has(goal.id)
    ? <span key={goal.id} title={goal.text} className="flex-none text-xs text-focus-accent">G{goal.position}</span>
    : null)}</>;
}
