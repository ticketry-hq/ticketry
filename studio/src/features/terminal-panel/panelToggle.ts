/**
 * What toggling the terminal panel means (#667).
 *
 * The panel has more than one keyboard entry point — the browser keymap
 * binding, and on the desktop build a chord the native libghostty view
 * recognises for Studio while it owns the keyboard — so the action itself
 * lives here and every entry point calls it. There is one definition of what
 * the toggle does to the panel and to the navigation zone.
 */

import { useClientStore } from "../../state/clientStore";
import { isTerminalPanelOpenIn, useTerminalPanelStore } from "./panelStore";

// The panel temporarily takes typing focus. Remember only an engaged active
// body: closing from another navigation zone must not unexpectedly pull focus
// away from where the person moved while the panel was open.
let restoreActiveBodyEngagement = false;

export function toggleTerminalPanel(): void {
  const ui = useClientStore.getState();
  // The panel belongs to the module it opens onto, so the toggle acts on the
  // selected one and on no other (#730).
  const moduleId = ui.selectedModuleId;
  if (!moduleId) return;
  const wasOpen = isTerminalPanelOpenIn(moduleId);
  if (!wasOpen) {
    restoreActiveBodyEngagement =
      ui.editViewZone === "active-tab-body" && ui.editViewBodyEngaged;
    useTerminalPanelStore.getState().showShells(moduleId);
  }
  useTerminalPanelStore.getState().togglePanel(moduleId);
  // The panel is a navigation zone while it is showing, so the toggle also
  // moves the zone: opening lands in it (and in typing mode), closing hands the
  // zone back rather than leaving the cycle pointing at a surface that is gone.
  if (!wasOpen) ui.setEditViewZone("terminal-panel");
  else if (ui.editViewZone === "terminal-panel") {
    ui.setEditViewZone("active-tab-body");
    if (restoreActiveBodyEngagement) ui.setEditViewBodyEngaged(true);
  }
  if (wasOpen) restoreActiveBodyEngagement = false;
}
