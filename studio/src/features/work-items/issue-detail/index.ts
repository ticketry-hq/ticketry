// Issue module — the issue detail workspace as a droppable unit.
//
// Import ONLY from this file. The interface:
//   <IssueDetail />                    the open issue's two-pane detail
//   <IssueWorkspace />                 shared workspace pane + issue details
//                                      (drawer + Backlog pane, #837)
//   <IssueDrawerHeader />              drawer chrome for the open issue
//   useIssueDrawerWorkspace(issueKey)  hydrate issue context + profile;
//                                      returns the view model
//   resolveIssueWorkspaceContext(key)  resolve a work item's project/module/
//                                      task launch context from its key (#845)
//   useIssueStore                      open/close + field mutations for the
//                                      routed issue (transitional width)
//
// The app-level keymap uses the narrow appNavigation entrypoint. Other
// consumers use this file; internals remain implementation.

export { default as IssueDetail } from "./IssueDetail";
export { default as IssueWorkspace } from "./IssueWorkspace";
export { WorkspacePane } from "./WorkspacePane";
export type {
  ScratchLaunchMode,
  WorkspaceLauncherContext,
} from "./WorkspacePane";
export { default as IssueDrawerHeader } from "./IssueDrawerHeader";
export { useIssueDrawerWorkspace } from "./useIssueDrawerWorkspace";
export { routeTaskWorkspaceTabAction } from "./useTaskWorkspaceTabNavigation";
export { resolveIssueWorkspaceContext } from "./internal/issueWorkspaceContext";
export type { IssueWorkspaceContext } from "./internal/issueWorkspaceContext";
export { useIssueStore, deriveEpic, resolveBlockerChips } from "./internal/issueStore";
export type { DrawerLaunchContext } from "./internal/drawerWorkspaceStore";
export {
  DEFAULT_WORKSPACE,
  useIssueDrawerWorkspaceStore,
} from "./internal/drawerWorkspaceStore";
export {
  resumeTerminalTab,
} from "./workspaceActions";
export { closeTerminalTab } from "./closeTerminalTab";
export { terminalLabel } from "./terminalLabel";
