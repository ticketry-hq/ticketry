import type { IssueType, State } from "../../../../../features/workflows";
import type { WorkItem } from "../../../../../features/work-items";
import {
  isRunNowEligible,
  startRunNow,
  useRunNowPending,
  useRunNowTransitions,
} from "../../../../../features/work-items";
import { KeyBadge } from "../../../../../shared/ui/KeyChordHint";
import { useGlobalShortcutLabel } from "../../../../navigation/useGlobalShortcutLabel";

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
  const issueType = issueTypes.find((candidate) => candidate.id === item.issue_type_id);
  const currentState = states.find((candidate) => candidate.id === item.state_id);
  const transitions = useRunNowTransitions(
    item.project_id,
    item.issue_type_id,
    issueType?.name === "Story" && currentState?.name === "Ideas",
  );
  const pending = useRunNowPending(item.id);
  const shortcut = useGlobalShortcutLabel("run-now");
  if (!isRunNowEligible(item, states, issueTypes, transitions)) return null;

  return (
    <button
      type="button"
      aria-label="Run now"
      aria-busy={pending}
      disabled={pending}
      onClick={() => startRunNow(item, moduleId)}
      className="inline-flex h-7 flex-none items-center gap-2 border border-focus-accent px-2.5 text-sm text-text-primary hover:bg-pane-title disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Running now…" : "Run now"}
      {shortcut && !pending ? <KeyBadge>{shortcut}</KeyBadge> : null}
    </button>
  );
}
