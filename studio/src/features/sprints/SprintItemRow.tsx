import type { PlanningState, PlanningWorkItem } from "../planning-graph";

export default function SprintItemRow({ item, state, selected, onOpen }: {
  item: PlanningWorkItem;
  state: PlanningState | undefined;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  return <button type="button" onClick={() => onOpen(item.id)} aria-pressed={selected}
    className={`flex w-full items-center gap-3 border-l-2 px-3 py-1.5 text-left hover:bg-pane-title ${selected ? "border-focus-accent bg-pane-title" : "border-transparent"}`}>
    <span className="w-24 shrink-0 truncate text-xs text-focus-accent">{item.key}</span>
    <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{item.name}</span>
    {state && <span className="text-xs text-text-secondary">{state.name}</span>}
  </button>;
}
