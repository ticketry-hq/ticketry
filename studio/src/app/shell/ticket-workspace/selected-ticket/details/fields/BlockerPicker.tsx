import { reachable } from "../../../../../../features/work-items";
import { stateById, useCachedStates } from "../../../../../../features/projects";
import type { WorkItem } from "../../../../../../shared/api/types";
import { stateColor } from "../../../../../../shared/utilities/display";
import Popover from "./Popover";
import { GhostChipAdd } from "./QuietChipControls";
import WorkItemSearchList from "./WorkItemSearchList";

interface Props {
  /** The issue being edited. */
  issueId: string;
  projectId: string;
  items: WorkItem[];
  /** Its current blocker ids — already-added candidates are hidden. */
  currentIds: string[];
  /** Add one blocker (the parent folds it into the replace-set). */
  onPick: (id: string) => void;
  saving?: boolean;
}

// Blocker picker: project work-items minus self, current blockers, and any
// candidate that would create a cycle, searched with the same list as the
// Parent picker. Selecting one folds it into the issue's blocked_by replace-set.
export default function BlockerPicker({ issueId, projectId, items, currentIds, onPick, saving }: Props) {
  const states = useCachedStates(projectId);
  const current = new Set(currentIds);
  // Ids this issue blocks (transitively) would close a cycle if added as a
  // blocker — hide them up front; the server's BFS guard is the backstop.
  const cyclic = reachable(issueId, items, ["blocks_ids"]);
  const candidates = items.filter(
    (i) => i.id !== issueId && !current.has(i.id) && !cyclic.has(i.id),
  );

  return (
    <Popover
      data-testid="blocker-picker"
      align="right"
      disabled={saving}
      trigger={({ onClick, disabled }) => (
        <GhostChipAdd onClick={onClick} disabled={disabled} label="Add blocker" />
      )}
    >
      {(close) => (
        <WorkItemSearchList
          tasks={candidates}
          value={null}
          onSelect={(id) => id && onPick(id)}
          close={close}
          taskLeading={(c) => (
            <span
              className="h-2 w-2 flex-none"
              style={{ backgroundColor: stateColor(stateById(states, c.state)) }}
            />
          )}
        />
      )}
    </Popover>
  );
}
