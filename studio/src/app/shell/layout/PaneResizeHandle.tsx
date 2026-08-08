import type { CSSProperties } from "react";
import {
  disableGlobalCursorStyles,
  PanelResizeHandle,
} from "react-resizable-panels";

const RESIZE_HANDLE_CLASS =
  "w-px bg-pane-border hover:bg-focus-accent";
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

export function PaneResizeHandle() {
  return (
    <PanelResizeHandle
      aria-label="Resize adjacent panes"
      aria-orientation="vertical"
      className={RESIZE_HANDLE_CLASS}
      data-testid="pane-resize-handle"
      style={RESIZE_HANDLE_STYLE}
    >
      <span aria-hidden="true" style={HOVER_TARGET_STYLE} />
    </PanelResizeHandle>
  );
}
