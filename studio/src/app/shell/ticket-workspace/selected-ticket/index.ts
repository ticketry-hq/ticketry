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
  useIssueStore,
  deriveEpic,
  resolveBlockerChips,
} from "../../../../features/work-items/issueStore";
export {
  DEFAULT_WORKSPACE,
  useTicketWorkspaceStore,
} from "./state/ticketWorkspaceStore";
export {
  resumeTerminalTab,
} from "./internal/workspaceActions";
export { closeTerminalTab } from "./internal/closeTerminalTab";
export { terminalLabel } from "./internal/terminalLabel";
