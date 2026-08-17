/**
 * The visible panel's maximize/restore control (#726).
 *
 * One button carries both directions, named for the action it would perform:
 * "Maximize terminal panel" while the panel is at an ordinary height and
 * "Restore terminal panel size" while it is maximized. Maximizing is a frame
 * resize and nothing else — it selects no shell, claims no foreground and
 * touches no run — so the size mode is all this control writes.
 */

import type { MouseEvent as ReactMouseEvent } from "react";

import { IconMaximize, IconRestore } from "../../shared/ui/icons";
import { useTerminalPanelStore } from "./panelStore";

export const MAXIMIZE_PANEL_LABEL = "Maximize terminal panel";
export const RESTORE_PANEL_LABEL = "Restore terminal panel size";

export function MaximizePanelButton() {
  const maximized = useTerminalPanelStore((state) => state.maximized);
  const toggleMaximized = useTerminalPanelStore(
    (state) => state.toggleMaximized,
  );
  const label = maximized ? RESTORE_PANEL_LABEL : MAXIMIZE_PANEL_LABEL;

  // Like the minimize control, the press is consumed here rather than reaching
  // the terminal underneath: a sizing click must never become shell input.
  function onMouseDown(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <button
      type="button"
      data-testid="terminal-panel-maximize"
      aria-label={label}
      title={label}
      onMouseDown={onMouseDown}
      onClick={(event) => {
        event.stopPropagation();
        toggleMaximized();
      }}
      className="flex items-center px-2 text-text-muted hover:bg-pane-panel hover:text-text-primary"
    >
      {maximized ? <IconRestore size={14} /> : <IconMaximize size={14} />}
    </button>
  );
}
