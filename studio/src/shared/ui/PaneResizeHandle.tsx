import type { CSSProperties } from "react";
import {
  disableGlobalCursorStyles,
  PanelResizeHandle,
} from "react-resizable-panels";

const RESIZE_HANDLE_STYLE = {
  cursor: "col-resize",
  position: "relative",
  zIndex: 10,
} satisfies CSSProperties;
const HOVER_TARGET_STYLE = {
  position: "absolute",
  insetBlock: 0,
  left: "50%",
  width: "11px",
  transform: "translateX(-50%)",
  cursor: "col-resize",
} satisfies CSSProperties;

disableGlobalCursorStyles();

export function PaneResizeHandle({
  label = "Resize adjacent panes",
  testId = "pane-resize-handle",
}: {
  label?: string;
  testId?: string;
}) {
  return (
    <PanelResizeHandle
      aria-label={label}
      aria-orientation="vertical"
      className="w-px bg-pane-border hover:bg-focus-accent"
      data-testid={testId}
      style={RESIZE_HANDLE_STYLE}
    >
      <span aria-hidden="true" style={HOVER_TARGET_STYLE} />
    </PanelResizeHandle>
  );
}
