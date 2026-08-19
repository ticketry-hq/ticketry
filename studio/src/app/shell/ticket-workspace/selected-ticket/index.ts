// Selected-ticket public interface. The main TicketWorkspace owns this module;
// consumers outside that tree use this narrow entrypoint.

export { default as IssueDetail } from "./details/IssueDetail";
export { SelectedTicketContent } from "./SelectedTicketContent";
export type {
  ScratchLaunchMode,
  TicketLaunchContext,
  WorkspaceLauncherContext,
} from "./SelectedTicketContent";
export { routeTaskWorkspaceTabAction } from "./internal/useTaskWorkspaceTabNavigation";
export {
  deriveEpic,
  resolveBlockerChips,
} from "../../../../features/work-items";
export {
  DEFAULT_WORKSPACE,
  useClientStore as useTicketWorkspaceStore,
} from "../../../../state/clientStore";
export { closeTerminalTab } from "./internal/closeTerminalTab";
