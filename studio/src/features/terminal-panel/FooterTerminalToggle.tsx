/**
 * The footer's always-available terminal panel control (#725).
 *
 * A hidden panel cannot carry its own restore control, so the one entry point
 * that is always on screen lives in the Studio footer. It names the action it
 * would perform rather than the surface it points at: "Open terminal panel"
 * while the panel is hidden, "Minimize terminal panel" while it is showing.
 * Like the panel's own minimize control it calls the shared toggle instead of
 * writing the open flag, so mouse and keyboard cannot drift apart.
 *
 * The panel belongs to the selected module (#730), so with no module selected
 * there is nothing for the control to open. Always on screen and always enabled
 * would make it a dead button — a click that produces no panel, no zone change
 * and no explanation — so it disables itself and says why instead (#739).
 */

import { useClientStore } from "../../state/clientStore";
import { IconPanelBottom } from "../../shared/ui/icons";
import { useTerminalPanelOpen } from "./panelStore";
import { toggleTerminalPanel } from "./panelToggle";
import { MINIMIZE_PANEL_LABEL } from "./MinimizePanelButton";

export const OPEN_PANEL_LABEL = "Open terminal panel";
export const NO_MODULE_PANEL_LABEL = "Select a module to open a terminal panel";

export function FooterTerminalToggle() {
  const open = useTerminalPanelOpen();
  const moduleId = useClientStore((state) => state.selectedModuleId);
  const unavailable = !moduleId;
  const label = unavailable
    ? NO_MODULE_PANEL_LABEL
    : open
      ? MINIMIZE_PANEL_LABEL
      : OPEN_PANEL_LABEL;
  return (
    <button
      type="button"
      data-testid="footer-terminal-toggle"
      aria-label={label}
      title={label}
      disabled={unavailable}
      onClick={() => toggleTerminalPanel()}
      className="flex items-center gap-1 px-1.5 py-0.5 text-text-muted hover:bg-pane-bg hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-muted"
    >
      <IconPanelBottom size={14} />
      <span>Terminal</span>
    </button>
  );
}
