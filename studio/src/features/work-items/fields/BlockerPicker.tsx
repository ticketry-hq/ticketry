import { useWorkItems } from "../hooks";
import { stateColor } from "../../../shared/utilities/display";
import { reachable } from "../utilities/dependencyGraph";
import Popover, { PopoverOption } from "./Popover";
import PopoverContent from "./PopoverContent";
import { GhostChipAdd } from "./QuietChipControls";

interface Props {
  /** The issue being edited. */
  issueId: string;
  /** Its current blocker ids — already-added candidates are hidden. */
  currentIds: string[];
  /** Add one blocker (the parent folds it into the replace-set). */
  onPick: (id: string) => void;
  saving?: boolean;
}

// Blocker picker: project work-items minus self, current blockers, and any
// candidate that would create a cycle. Mirrors the ParentPicker
// idiom; selecting one folds it into the open issue's blocked_by replace-set.
export default function BlockerPicker({ issueId, currentIds, onPick, saving }: Props) {
  const { items } = useWorkItems();
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
        <GhostChipAdd
          onClick={onClick}
          disabled={disabled}
          label="Add blocker"
        />
      )}
    >
      {(close) => (
        <PopoverContent>
          {candidates.length === 0 ? (
            <div className="px-3 py-2 text-sm text-text-muted">No eligible issues.</div>
          ) : (
            candidates.map((c) => (
              <PopoverOption
                key={c.id}
                onClick={() => {
                  onPick(c.id);
                  close();
                }}
              >
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ backgroundColor: stateColor(c.state) }}
                />
                <span className="w-20 flex-none font-mono text-xs text-text-muted">
                  {c.key}
                </span>
                <span className="flex-1 truncate">{c.name}</span>
              </PopoverOption>
            ))
          )}
        </PopoverContent>
      )}
    </Popover>
  );
}
