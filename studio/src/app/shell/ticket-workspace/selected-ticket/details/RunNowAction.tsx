import type { IssueType, State, WorkItem } from "../../../../../shared/api/types";
import {
  isRunNowEligible,
  startRunNow,
  useRunNowPending,
  useRunNowTransitions,
} from "../../../../../features/work-items";

export function RunNowAction({
  item,
  moduleId,
  states,
  issueTypes,
}: {
  item: WorkItem;
  moduleId: string | null;
  states: readonly State[];
  issueTypes: readonly IssueType[];
}) {
  const issueType = issueTypes.find((candidate) => candidate.id === item.issue_type);
  const currentState = states.find((candidate) => candidate.id === item.state);
  const transitions = useRunNowTransitions(
    item.issue_type,
    issueType?.name === "Story" && currentState?.name === "Ideas",
  );
  const pending = useRunNowPending(item.id);
  if (!isRunNowEligible(item, states, issueTypes, transitions)) return null;

  return (
    <button
      type="button"
      aria-label="Run now"
      aria-busy={pending}
      disabled={pending}
      onClick={() => startRunNow(item, moduleId)}
      className="flex-none border border-focus-accent px-2.5 py-1 text-sm text-text-primary hover:bg-pane-title disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Running now…" : "Run now"}
    </button>
  );
}
