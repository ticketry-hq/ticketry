import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { StorySprintHistoryCollection } from "../../sprints";
import { SprintChoiceCollection } from "./SprintChoiceCollection";
import { SprintChoiceOption, type BasicSprintChoice } from "./SprintChoiceOption";
export type { BasicSprintChoice } from "./SprintChoiceOption";

export function SprintChoicePopover({ id, choices, planned, completed, expanded, onExpand, search, scope, onSearchChange, initialFocus, onChoose, onClose }: {
  id: string; choices: BasicSprintChoice[];
  planned: { collection: StorySprintHistoryCollection; choices: BasicSprintChoice[] };
  completed: { collection: StorySprintHistoryCollection; choices: BasicSprintChoice[] };
  expanded: "Planned" | "Completed" | null;
  onExpand: (section: "Planned" | "Completed" | null) => void;
  search: string;
  scope: string;
  onSearchChange: (value: string) => void;
  initialFocus: "search" | "selected";
  onChoose: (intent: BasicSprintChoice["intent"]) => void;
  onClose: (returnFocus?: boolean) => void;
}) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const tabStop = focusedIndex ?? Math.max(0, choices.findIndex((choice) => choice.selected));
  const searchInput = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (initialFocus === "search") { searchInput.current?.focus(); return; }
    const options = ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const selected = ref.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
    (selected ?? options?.[0])?.focus();
  }, []);
  function handleKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); onClose(true); return;
    }
    const isInput = event.target instanceof HTMLInputElement;
    if (isInput && event.key !== "ArrowDown") return;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const options = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
      const current = options.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
    }
    if ((event.key === " " || event.key === "Enter") && event.target instanceof HTMLButtonElement) {
      event.preventDefault(); event.stopPropagation();
      (event.target as HTMLButtonElement).click();
    }
  }
  return <div ref={ref} id={id} role="dialog" aria-label="Choose sprint" onKeyDown={handleKey}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose(); }}
    className="absolute left-0 right-0 z-30 flex max-h-[min(32rem,70dvh)] min-h-0 flex-col overflow-hidden border border-pane-border bg-pane-bg p-1 shadow-xl">
    <div className="shrink-0 px-2 py-1 text-[10px] text-text-muted">SHOW PROJECT STORIES FROM</div>
    <div className="flex shrink-0 gap-1 border-b border-pane-border px-2 py-1">
      <input ref={searchInput} type="text" aria-label="Search sprints" placeholder="Search sprints…" value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent py-2 text-xs text-text-primary focus:outline focus:outline-1 focus:outline-focus-accent" />
      {search ? <button type="button" aria-label="Clear sprint search" onClick={() => { onSearchChange(""); searchInput.current?.focus(); }}
        className="shrink-0 px-2 text-text-muted focus:outline focus:outline-1 focus:outline-focus-accent">×</button> : null}
    </div>
    <div role="listbox" aria-label="Sprint choices" className="shrink-0">
      {choices.map((choice, index) => <SprintChoiceOption key={index} choice={choice} onChoose={onChoose}
        onFocus={() => setFocusedIndex(index)} tabIndex={index === tabStop ? 0 : -1} />)}
    </div>
    <SprintChoiceCollection key={`Planned:${scope}`} title="Planned" expanded={expanded === "Planned"} onToggle={() => onExpand(expanded === "Planned" ? null : "Planned")}
      {...planned} onChoose={onChoose} />
    <SprintChoiceCollection key={`Completed:${scope}`} title="Completed" expanded={expanded === "Completed"} onToggle={() => onExpand(expanded === "Completed" ? null : "Completed")}
      {...completed} onChoose={onChoose} />
    <div className="shrink-0 px-2 py-1 text-[10px] text-text-muted">↑↓ choose · Enter select · Esc close</div>
  </div>;
}
