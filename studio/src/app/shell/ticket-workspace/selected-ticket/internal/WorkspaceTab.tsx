import type { ReactNode } from "react";
import type {
  DragSourceProps,
  DropIntent,
  DropTargetProps,
} from "../../../../../shared/dragDrop/useAxisDragAndDrop";

/**
 * One tab of the task workspace strip.
 *
 * Colour is a prop rather than a rule here: Details and document tabs use the
 * neutral chrome below, while terminal tabs pass the provider/liveness tone
 * resolved by the shared terminal presentation rule. Selection, the keyboard
 * highlight ring, and the lifecycle badge stay independent axes.
 */
export function WorkspaceTab({
  label,
  accessibleName,
  title,
  active,
  highlighted,
  allowHoverEmphasis,
  tone,
  badge,
  onClick,
  onClose,
  closeLabel,
  dropIntent,
  registerRef,
  dragSourceProps,
  dropTargetProps,
}: {
  label: string;
  /** Assistive name when the visible label is not enough on its own. */
  accessibleName?: string;
  title?: string;
  active: boolean;
  highlighted?: boolean;
  allowHoverEmphasis: boolean;
  /** Colour classes replacing the neutral chrome (background/border/text). */
  tone?: string;
  badge?: ReactNode;
  onClick: () => void;
  onClose?: () => void;
  closeLabel?: string;
  dropIntent: DropIntent | null;
  registerRef: (node: HTMLDivElement | null) => void;
  dragSourceProps: DragSourceProps;
  dropTargetProps: DropTargetProps;
}) {
  const name = accessibleName ?? label;
  const chrome =
    tone ??
    (active
      ? "border-focus-accent bg-pane-title text-text-primary"
      : `border-pane-border bg-pane-bg text-text-muted ${
          allowHoverEmphasis ? "hover:bg-pane-title" : ""
        }`);
  const { ref: registerDropTarget, ...dropHandlers } = dropTargetProps;
  return (
    <div
      ref={(node) => {
        registerRef(node);
        registerDropTarget(node);
      }}
      role="tab"
      aria-selected={active}
      aria-label={name}
      title={title}
      data-highlighted={highlighted || undefined}
      onClick={onClick}
      {...dragSourceProps}
      {...dropHandlers}
      className={`relative flex shrink-0 cursor-pointer items-center gap-2 border px-2 py-0.5 text-xs ${chrome} ${
        highlighted ? "ring-1 ring-focus-accent ring-inset" : ""
      }`}
    >
      {dropIntent !== null ? (
        <span
          data-testid="workspace-tab-drop-seam"
          data-drop-intent={dropIntent}
          aria-hidden="true"
          className={`pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-focus-accent ${
            dropIntent === "near" ? "left-0" : "right-0"
          }`}
        />
      ) : null}
      <span>{label}</span>
      {badge}
      {onClose && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="opacity-70 hover:opacity-100"
          aria-label={closeLabel ?? `Close ${name}`}
        >
          ×
        </button>
      )}
    </div>
  );
}
