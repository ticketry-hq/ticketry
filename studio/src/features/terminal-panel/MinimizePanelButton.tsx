/**
 * The visible panel's own minimize control (#725).
 *
 * Minimize means hide the panel — not shrink it, and not close the shell that
 * is showing. It therefore goes through the same shared toggle the keyboard
 * shortcut and the footer control use, so there is exactly one definition of
 * what hiding the panel does to the navigation zone, focus and the mounted
 * viewer.
 */

import type { MouseEvent as ReactMouseEvent } from "react";

import { IconMinimize } from "../../shared/ui/icons";
import { toggleTerminalPanel } from "./panelToggle";

export const MINIMIZE_PANEL_LABEL = "Minimize terminal panel";

export function MinimizePanelButton() {
  // The control sits over a surface whose whole job is to swallow pointer
  // input. Preventing the default keeps the press from being taken as a click
  // into the shell — it stays panel furniture, and focus stays where it was.
  function onMouseDown(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <button
      type="button"
      data-testid="terminal-panel-minimize"
      aria-label={MINIMIZE_PANEL_LABEL}
      title={MINIMIZE_PANEL_LABEL}
      onMouseDown={onMouseDown}
      onClick={(event) => {
        event.stopPropagation();
        toggleTerminalPanel();
      }}
      className="flex items-center px-2 text-text-muted hover:bg-pane-panel hover:text-text-primary"
    >
      <IconMinimize size={14} />
    </button>
  );
}
