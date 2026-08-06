import { useMemo, useState } from "react";
import { useStudioStore } from "../../../../../../features/projects/store";
import { useModulesQuery } from "../../../../../../features/projects";

const EMPTY_MODULES: Module[] = [];
import { useWorkItems } from "../../../../../../features/work-items";
import type { Module, WorkItem } from "../../../../../../shared/api/types";
import Popover, { PopoverOption } from "./Popover";
import { IconCornerDownRight } from "../../../../../../shared/ui/icons";
import PickerTrigger from "./PickerTrigger";
import PopoverSearch from "./PopoverSearch";
import PopoverContent from "./PopoverContent";

interface Props {
  value: string | null;
  /** The issue being edited — excluded (with its descendants) to avoid cycles. */
  currentId?: string;
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

// Match a candidate against the search query by key (e.g. "MEML-7"), number
// (the sequence id), or name. The query is matched case-insensitively, and a
// bare number matches the sequence id so users can find an epic by its number.
function matches(
  item: { key: string; name: string; sequence_id: number | null },
  q: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (item.key.toLowerCase().includes(needle)) return true;
  if (item.name.toLowerCase().includes(needle)) return true;
  if (item.sequence_id != null && String(item.sequence_id).includes(needle)) return true;
  return false;
}

// Parent picker: an Epic (module) or a task. Reparents the tree.
export default function ParentPicker({ value, currentId, onChange, saving }: Props) {
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const modules = useModulesQuery(selectedProjectId).data ?? EMPTY_MODULES;
  const { items } = useWorkItems();

  const blocked = currentId
    ? new Set([currentId, ...descendantIds(currentId, items)])
    : new Set<string>();
  const taskOptions = items.filter((i) => !blocked.has(i.id));

  const currentModule = modules.find((m) => m.id === value);
  const currentTask = items.find((i) => i.id === value);
  const label = currentModule
    ? currentModule.key
    : currentTask
      ? currentTask.key
      : "No parent";

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
        <PickerBody
          modules={modules}
          taskOptions={taskOptions}
          value={value}
          onChange={onChange}
          close={close}
        />
      )}
    </Popover>
  );
}

interface BodyProps {
  modules: Module[];
  taskOptions: WorkItem[];
  value: string | null;
  onChange: (parentId: string | null) => void;
  close: () => void;
}

// The popover contents, with a search box that filters epics and tasks by key,
// number, or name. Lives in its own component so the query resets each time the
// popover (re)opens.
function PickerBody({ modules, taskOptions, value, onChange, close }: BodyProps) {
  const [query, setQuery] = useState("");
  const matchingModules = useMemo(() => modules.filter((m) => matches(m, query)), [modules, query]);
  const tasks = useMemo(
    () => taskOptions.filter((t) => matches(t, query)),
    [taskOptions, query],
  );

  return (
    <div>
      <PopoverSearch
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by number, key, or name…"
      />
      <PopoverContent>
        {query.trim() === "" && (
          <PopoverOption
            selected={value === null}
            onClick={() => {
              onChange(null);
              close();
            }}
          >
            <span className="text-text-muted">No parent</span>
          </PopoverOption>
        )}
        {matchingModules.length > 0 && (
          <div className="px-3 pb-0.5 pt-2 text-xs font-bold uppercase tracking-wider text-text-secondary">
            Modules
          </div>
        )}
        {matchingModules.map((m) => (
          <PopoverOption
            key={m.id}
            selected={m.id === value}
            onClick={() => {
              onChange(m.id);
              close();
            }}
          >
            <span className="w-20 flex-none text-xs text-text-muted">{m.key}</span>
            <span className="truncate">{m.name}</span>
          </PopoverOption>
        ))}
        {tasks.length > 0 && (
          <div className="px-3 pb-0.5 pt-2 text-xs font-bold uppercase tracking-wider text-text-secondary">
            Tasks
          </div>
        )}
        {tasks.map((t) => (
          <PopoverOption
            key={t.id}
            selected={t.id === value}
            onClick={() => {
              onChange(t.id);
              close();
            }}
          >
            <span className="w-20 flex-none text-xs text-text-muted">{t.key}</span>
            <span className="truncate">{t.name}</span>
          </PopoverOption>
        ))}
        {matchingModules.length === 0 && tasks.length === 0 && query.trim() !== "" && (
          <div className="px-3 py-2 text-sm text-text-muted">No matches.</div>
        )}
      </PopoverContent>
    </div>
  );
}
