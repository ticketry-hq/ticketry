import { ModuleLifecycleChicklets } from "../../../features/agents/status";
import {
  ModuleJumpBadge,
  type ModuleJumpBadgePresentation,
} from "../../../features/module-tabs";
import type {
  DragSourceProps,
  DropIntent,
  DropTargetProps,
} from "../../../shared/dragDrop/useAxisDragAndDrop";
import type { Module } from "../../../shared/api/types";

interface ModuleTabProps {
  module: Module;
  isSelected: boolean;
  /** The resolved insertion edge, or null when this tab is not the drop target. */
  dropIntent: DropIntent | null;
  onSelect: (moduleId: string) => void;
  onHide: (moduleId: string) => void;
  jumpBadge?: ModuleJumpBadgePresentation;
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
  onHide,
  jumpBadge,
  registerRef,
  dragSourceProps,
  dropTargetProps,
}: ModuleTabProps) {
  // The strip scrolls to this element and the drag controller measures it, so
  // both registrations run: neither may quietly replace the other.
  const { ref: registerDropTarget, ...dropHandlers } = dropTargetProps ?? {};
  return (
    <div className="group relative flex max-w-64 shrink-0 border-r border-pane-border">
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
        className={`relative flex min-w-0 flex-1 items-center py-0 pr-7 pl-3 text-xs ${
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
        {jumpBadge ? <ModuleJumpBadge badge={jumpBadge} /> : null}
      </button>
      <button
        type="button"
        aria-label={`Hide ${module.name} tab`}
        title="Hide tab"
        onClick={() => onHide(module.id)}
        className="absolute top-0 right-0 flex h-full w-7 items-center justify-center text-sm text-text-muted opacity-0 hover:bg-pane-bg hover:text-text-primary focus:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-accent group-hover:opacity-100"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
