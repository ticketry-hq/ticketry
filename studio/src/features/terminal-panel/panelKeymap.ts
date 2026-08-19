/**
 * The panel toggle's keyboard routing (#667).
 *
 * The binding is registered in the *capture* keymap context so it resolves
 * ahead of terminal typing mode, which otherwise hands an engaged terminal body
 * every key but its own exit chord. Without that, the one gesture for reaching
 * a shell would stop working exactly where a developer is most likely to be:
 * typing in an agent's terminal.
 *
 * On the desktop build's native renderer the WebView never sees the key at
 * all; that path arrives through the shared native chord bridge
 * (`app/navigation/nativeTerminalChords.ts`) and lands on the same action.
 */

import { toggleTerminalPanel } from "./panelToggle";

export const TOGGLE_TERMINAL_PANEL_ACTION = "toggle-terminal-panel";

/** Handles the panel toggle, reporting whether it consumed the event. */
export function routeTerminalPanelToggle(
  event: KeyboardEvent,
  actionId: string | null,
): boolean {
  if (actionId !== TOGGLE_TERMINAL_PANEL_ACTION) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  toggleTerminalPanel();
  return true;
}
