// Terminal panel — the bottom module terminal surface (#667, #1101).
//
// App runs and hand-driven login shells have separate segments. Agent runs keep
// their terminal tabs in the task workspace, and this panel never shows one.

export { TerminalPanel } from "./TerminalPanel";
export { FooterTerminalToggle } from "./FooterTerminalToggle";
export {
  isTerminalPanelOpenIn,
  useTerminalPanelOpen,
  useTerminalPanelStore,
  useTerminalPanelSegment,
} from "./panelStore";
export {
  routeTerminalPanelToggle,
  TOGGLE_TERMINAL_PANEL_ACTION,
} from "./panelKeymap";
export { toggleTerminalPanel } from "./panelToggle";
export { useModuleShellStore } from "./moduleShellStore";
export { MAX_MODULE_SHELLS, type ModuleShellSet } from "./shellTabSet";
