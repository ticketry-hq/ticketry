// Narrow public seam for app-level navigation. Selected-ticket UI imports its
// implementation directly; the global keymap needs only these actions and
// stores at startup.
export {
  routeTaskWorkspaceEditViewAction,
  routeTaskWorkspaceTabAction,
} from "./internal/useTaskWorkspaceTabNavigation";
export { useClientStore as useTicketWorkspaceStore } from "../../../../state/clientStore";
export { closeTerminalTab } from "./internal/closeTerminalTab";
