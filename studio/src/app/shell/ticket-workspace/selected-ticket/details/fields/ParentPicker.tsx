import { useModulesQuery, useStudioStore } from "../../../../../../features/projects";
import { formatWorkItemDisplayIdentifier } from "../../../../../../features/work-items";
import type { Module, WorkItem } from "../../../../../../shared/api/types";
import { IconCornerDownRight } from "../../../../../../shared/ui/icons";
import Popover from "../../../../../../shared/ui/Popover";
import PickerTrigger from "./PickerTrigger";
import WorkItemSearchList from "../../../../../../features/work-items/WorkItemSearchList";

const EMPTY_MODULES: Module[] = [];

interface Props {
  value: string | null;
  /** The issue being edited — excluded (with its descendants) to avoid cycles. */
  currentId?: string;
  items: WorkItem[];
  onChange: (parentId: string | null) => void;
  saving?: boolean;
}

// Collect an item's descendant ids so a reparent can never point into its own
// subtree (which would orphan a cycle).
function descendantIds(rootId: string, items: WorkItem[]): Set<string> {
  const out = new Set<string>();
  let frontier = [rootId];
  while (frontier.length) {
    const next: string[] = [];
    for (const it of items) {
      if (it.parent_id && frontier.includes(it.parent_id) && !out.has(it.id)) {
        out.add(it.id);
        next.push(it.id);
      }
    }
    frontier = next;
  }
  return out;
}

// Parent picker: an Epic (module) or a task. Reparents the tree.
export default function ParentPicker({ value, currentId, items, onChange, saving }: Props) {
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const modules = useModulesQuery(selectedProjectId).data ?? EMPTY_MODULES;
  const blocked = currentId
    ? new Set([currentId, ...descendantIds(currentId, items)])
    : new Set<string>();
  const taskOptions = items.filter((i) => !blocked.has(i.id));

  const currentModule = modules.find((m) => m.id === value);
  const currentTask = items.find((i) => i.id === value);
  // A resolved parent with no sequence identifier falls back to the same
  // neutral trigger text rather than showing a malformed identifier.
  const label =
    formatWorkItemDisplayIdentifier((currentModule ?? currentTask)?.sequence_id) || "No parent";

  return (
    <Popover
      data-testid="parent-picker"
      align="right"
      disabled={saving}
      trigger={({ onClick, disabled }) => (
        <PickerTrigger
          onClick={onClick}
          disabled={disabled}
          label={label}
          icon={<IconCornerDownRight size={14} className="text-text-muted" />}
        />
      )}
    >
      {(close) => (
        <WorkItemSearchList
          modules={modules}
          tasks={taskOptions}
          value={value}
          onSelect={onChange}
          close={close}
          emptyLabel="No parent"
        />
      )}
    </Popover>
  );
}
