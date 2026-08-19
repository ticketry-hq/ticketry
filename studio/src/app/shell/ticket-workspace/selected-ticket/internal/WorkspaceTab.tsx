import type { ReactNode } from "react";

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
}) {
  const name = accessibleName ?? label;
  const chrome =
    tone ??
    (active
      ? "border-focus-accent bg-pane-title text-text-primary"
      : `border-pane-border bg-pane-bg text-text-muted ${
          allowHoverEmphasis ? "hover:bg-pane-title" : ""
        }`);
  return (
    <div
      role="tab"
      aria-selected={active}
      aria-label={name}
      title={title}
      data-highlighted={highlighted || undefined}
      onClick={onClick}
      className={`flex shrink-0 cursor-pointer items-center gap-2 border px-2 py-0.5 text-xs ${chrome} ${
        highlighted ? "ring-1 ring-focus-accent ring-inset" : ""
      }`}
    >
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
