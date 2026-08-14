import { useShallow } from "zustand/react/shallow";
import {
  MODULE_LIFECYCLE_STATES,
  selectModuleLifecycleCounts,
  useAgentStatusStore,
} from "../../../features/agents/status";
import { LifecycleBadge } from "../../../features/agents/terminal";
import type {
  DragSourceProps,
  DropIntent,
  DropTargetProps,
} from "../../../shared/dragDrop/useAxisDragAndDrop";
import type { Module } from "../../../shared/api/types";

function ModuleLifecycleChicklets({ moduleId }: { moduleId: string }) {
  const counts = useAgentStatusStore(
    useShallow((state) => selectModuleLifecycleCounts(state, moduleId)),
  );
  const visibleStates = MODULE_LIFECYCLE_STATES.filter(
    (state) => counts[state] > 0,
  );
  if (visibleStates.length === 0) return null;

  return (
    <span className="ml-2 inline-flex shrink-0 items-center gap-1">
      {visibleStates.map((state) => (
        <LifecycleBadge
          key={state}
          state={state}
          count={counts[state]}
          showLabel={false}
          alwaysShowCount
        />
      ))}
    </span>
  );
}

interface ModuleTabProps {
  module: Module;
  isSelected: boolean;
  /** The resolved insertion edge, or null when this tab is not the drop target. */
  dropIntent: DropIntent | null;
  onSelect: (moduleId: string) => void;
  /** Registers the tab element so the strip can scroll the selected one into view. */
  registerRef: (moduleId: string, node: HTMLButtonElement | null) => void;
  dragSourceProps?: DragSourceProps;
  dropTargetProps?: DropTargetProps;
}

/**
 * One Module tab: the click target that selects it, the drag source that moves
 * it, and the drop target that receives another one (#361).
 *
 * The insertion indicator is drawn on the resolved left/right edge rather than
 * by shifting tabs, so the selected-tab styling, lifecycle badges, and the
 * element the strip scrolls to are exactly what they are when nothing is being
 * dragged.
 */
export function ModuleTab({
  module,
  isSelected,
  dropIntent,
  onSelect,
  registerRef,
  dragSourceProps,
  dropTargetProps,
}: ModuleTabProps) {
  // The strip scrolls to this element and the drag controller measures it, so
  // both registrations run: neither may quietly replace the other.
  const { ref: registerDropTarget, ...dropHandlers } = dropTargetProps ?? {};
  return (
    <button
      ref={(node) => {
        registerRef(module.id, node);
        registerDropTarget?.(node);
      }}
      data-module-id={module.id}
      type="button"
      role="tab"
      aria-label={module.name}
      aria-selected={isSelected}
      tabIndex={-1}
      title={module.name}
      onClick={() => onSelect(module.id)}
      {...dragSourceProps}
      {...dropHandlers}
      className={`relative flex max-w-64 shrink-0 items-center border-r border-pane-border px-3 text-xs ${
        isSelected
          ? "bg-pane-panel font-semibold text-text-primary shadow-[inset_0_-2px_0_0_#7aa2f7]"
          : "text-text-muted hover:bg-pane-panel hover:text-text-primary"
      }`}
    >
      {dropIntent !== null ? (
        <span
          data-testid="module-tab-drop-seam"
          data-drop-intent={dropIntent}
          aria-hidden="true"
          className={`pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-focus-accent ${
            dropIntent === "near" ? "left-0" : "right-0"
          }`}
        />
      ) : null}
      <span className="truncate">{module.name}</span>
      <ModuleLifecycleChicklets moduleId={module.id} />
    </button>
  );
}
