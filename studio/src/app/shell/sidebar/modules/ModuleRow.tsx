import type {
  DragSourceProps,
  DropIntent,
  DropTargetProps,
} from "../../../../shared/dragDrop/useAxisDragAndDrop";
import type { Module } from "../../../../shared/api/types";

interface ModuleRowProps {
  module: Module;
  isSelected: boolean;
  isFocused: boolean;
  /** The resolved insertion edge, or null when this row is not the drop target. */
  dropIntent: DropIntent | null;
  onSelect: (moduleId: string) => void;
  dragSourceProps?: DragSourceProps;
  dropTargetProps?: DropTargetProps;
}

/**
 * One sidebar Module row: the click target that selects it, the drag source
 * that moves it, and the drop target that receives another one (#360).
 *
 * The insertion indicator is drawn on the resolved edge rather than by shifting
 * rows, so selection highlight, keyboard focus styling, and row identity are
 * exactly what they are when nothing is being dragged.
 */
export function ModuleRow({
  module,
  isSelected,
  isFocused,
  dropIntent,
  onSelect,
  dragSourceProps,
  dropTargetProps,
}: ModuleRowProps) {
  return (
    <li
      data-module-id={module.id}
      onClick={() => onSelect(module.id)}
      {...dragSourceProps}
      {...dropTargetProps}
      className={`relative cursor-pointer truncate px-1 py-0.5 ${
        isSelected
          ? "bg-selection-bg text-text-primary"
          : isFocused
            ? "bg-pane-title text-text-primary"
            : "text-text-primary hover:bg-pane-title"
      }`}
    >
      {dropIntent !== null ? (
        <span
          data-testid="module-drop-seam"
          data-drop-intent={dropIntent}
          aria-hidden="true"
          className={`pointer-events-none absolute right-0 left-0 z-10 h-0.5 bg-focus-accent ${
            dropIntent === "near" ? "top-0" : "bottom-0"
          }`}
        />
      ) : null}
      {"📦 "}
      {module.name}
    </li>
  );
}
