/**
 * The panel's top edge, dragged to trade terminal height against the work item
 * above it (#669).
 *
 * The panel is a fixed-height strip below the workspace rather than a member of
 * the horizontal pane group, so it resizes in pixels of its own: dragging the
 * edge up grows the panel by exactly the distance the pointer travelled. The
 * grip is also focusable and answers the arrow keys, so height is not a
 * pointer-only setting.
 */

import { useCallback, useEffect, useRef } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

import { usePanelDisplayHeight } from "./panelDisplayHeight";
import { useTerminalPanelStore } from "./panelStore";

const GRIP_STYLE = {
  cursor: "row-resize",
  position: "relative",
  zIndex: 10,
} satisfies CSSProperties;

const HOVER_TARGET_STYLE = {
  position: "absolute",
  insetInline: 0,
  top: "50%",
  height: "11px",
  transform: "translateY(-50%)",
  cursor: "row-resize",
} satisfies CSSProperties;

export function PanelResizeGrip() {
  // A drag or a nudge starts from the height the panel is showing, so pulling
  // the edge of a maximized panel moves from where the person sees it and the
  // resulting height becomes the new ordinary one (#726).
  const height = usePanelDisplayHeight();
  const maximized = useTerminalPanelStore((state) => state.maximized);
  const setHeight = useTerminalPanelStore((state) => state.setHeight);
  const nudgeHeight = useTerminalPanelStore((state) => state.nudgeHeight);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

  const onMouseMove = useCallback(
    (event: MouseEvent) => {
      const active = drag.current;
      if (!active) return;
      // Upwards is taller: the panel is anchored to the bottom of the window.
      setHeight(active.startHeight + (active.startY - event.clientY));
    },
    [setHeight],
  );

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("blur", endDrag);
    };
  }, [onMouseMove, endDrag]);

  function onMouseDown(event: ReactMouseEvent<HTMLDivElement>): void {
    drag.current = { startY: event.clientY, startHeight: height };
    // Taking hold of the edge is already direct manipulation: the panel leaves
    // maximized mode there, so a drag that travels no distance still leaves the
    // person with an ordinary panel at the height they are looking at.
    if (maximized) setHeight(height);
    // Keeps the drag from selecting the terminal text underneath it.
    event.preventDefault();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const steps = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (steps === 0) return;
    event.preventDefault();
    event.stopPropagation();
    nudgeHeight(steps);
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the terminal panel"
      aria-valuenow={height}
      tabIndex={0}
      data-testid="terminal-panel-resize-grip"
      className="h-px shrink-0 bg-pane-border hover:bg-focus-accent"
      style={GRIP_STYLE}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true" style={HOVER_TARGET_STYLE} />
    </div>
  );
}
