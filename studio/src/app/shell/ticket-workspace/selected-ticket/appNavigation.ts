// Narrow public seam for app-level navigation. Selected-ticket UI imports its
// implementation directly; the global keymap needs only these actions and
// stores at startup.
export {
  routeTaskWorkspaceEditViewAction,
  routeTaskWorkspaceTabAction,
} from "./internal/useTaskWorkspaceTabNavigation";
export { useTicketWorkspaceStore } from "./state/ticketWorkspaceStore";
export { closeTerminalTab } from "./internal/closeTerminalTab";
