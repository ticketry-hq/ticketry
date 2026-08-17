// Terminal panel — the bottom shell surface of the ticket workspace (#667).
//
// It hosts hand-driven login shells for the selected module. Agent runs are not
// its business: they keep their terminal tabs in the task workspace, and this
// panel never shows one.

export { TerminalPanel } from "./TerminalPanel";
export { FooterTerminalToggle } from "./FooterTerminalToggle";
export {
  isTerminalPanelOpenIn,
  useTerminalPanelOpen,
  useTerminalPanelStore,
} from "./panelStore";
export {
  routeTerminalPanelToggle,
  TOGGLE_TERMINAL_PANEL_ACTION,
} from "./panelKeymap";
export { toggleTerminalPanel } from "./panelToggle";
export { useModuleShellStore } from "./moduleShellStore";
export { MAX_MODULE_SHELLS, type ModuleShellSet } from "./shellTabSet";
