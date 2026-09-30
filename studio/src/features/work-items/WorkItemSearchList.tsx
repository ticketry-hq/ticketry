import { type ReactNode, useMemo, useState } from "react";
import { formatWorkItemDisplayIdentifier } from "./displayIdentifier";
import type { Module, WorkItem } from "../../shared/api/types";
import { PopoverOption } from "../../shared/ui/Popover";
import PopoverSearch from "../../shared/ui/PopoverSearch";
import PopoverContent from "../../shared/ui/PopoverContent";

interface Searchable {
  id: string;
  key: string;
  name: string;
  sequence_id: number | null;
}

// Match a candidate against the search query by key (e.g. "MEML-7"), number
// (the sequence id), or name, case-insensitively.
function matches(item: Searchable, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (item.key.toLowerCase().includes(needle)) return true;
  if (item.name.toLowerCase().includes(needle)) return true;
  return item.sequence_id != null && String(item.sequence_id).includes(needle);
}

interface Props {
  /** Optional epic (module) candidates, listed first under "Modules". */
  modules?: Module[];
  tasks: WorkItem[];
  value: string | null;
  onSelect: (id: string | null) => void;
  close: () => void;
  /** When set, a "clear" row with this label is shown for a blank query. */
  emptyLabel?: string;
  /** Extra leading content per task row (e.g. a state colour dot). */
  taskLeading?: (task: WorkItem) => ReactNode;
}

const EMPTY_MODULES: Module[] = [];

// Searchable popover body shared by the Parent and Blocked-by pickers. Lives in
// its own component so the query resets each time the popover (re)opens.
export default function WorkItemSearchList({
  modules = EMPTY_MODULES,
  tasks,
  value,
  onSelect,
  close,
  emptyLabel,
  taskLeading,
}: Props) {
  const [query, setQuery] = useState("");
  const matchingModules = useMemo(() => modules.filter((m) => matches(m, query)), [modules, query]);
  const matchingTasks = useMemo(() => tasks.filter((t) => matches(t, query)), [tasks, query]);
  const pick = (id: string | null) => {
    onSelect(id);
    close();
  };
  const blank = query.trim() === "";

  return (
    <div>
      <PopoverSearch
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by number, key, or name…"
      />
      <PopoverContent>
        {emptyLabel && blank && (
          <PopoverOption selected={value === null} onClick={() => pick(null)}>
            <span className="text-text-muted">{emptyLabel}</span>
          </PopoverOption>
        )}
        {matchingModules.length > 0 && <GroupHeading>Modules</GroupHeading>}
        {matchingModules.map((m) => (
          <PopoverOption key={m.id} selected={m.id === value} onClick={() => pick(m.id)}>
            <Identifier sequenceId={m.sequence_id} />
            <span className="truncate">{m.name}</span>
          </PopoverOption>
        ))}
        {modules.length > 0 && matchingTasks.length > 0 && <GroupHeading>Tasks</GroupHeading>}
        {matchingTasks.map((t) => (
          <PopoverOption key={t.id} selected={t.id === value} onClick={() => pick(t.id)}>
            {taskLeading?.(t)}
            <Identifier sequenceId={t.sequence_id} />
            <span className="flex-1 truncate">{t.name}</span>
          </PopoverOption>
        ))}
        {matchingModules.length === 0 && matchingTasks.length === 0 && (
          <div className="px-3 py-2 text-sm text-text-muted">
            {blank ? "No eligible issues." : "No matches."}
          </div>
        )}
      </PopoverContent>
    </div>
  );
}

function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pb-0.5 pt-2 text-xs font-bold uppercase tracking-wider text-text-secondary">
      {children}
    </div>
  );
}

function Identifier({ sequenceId }: { sequenceId: number | null }) {
  return (
    <span className="w-20 flex-none font-mono text-xs text-text-muted">
      {formatWorkItemDisplayIdentifier(sequenceId)}
    </span>
  );
}
