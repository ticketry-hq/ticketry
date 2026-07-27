// Narrow public seam for app-level navigation. Feature UI continues to use
// the issue-detail entrypoint; the global keymap needs only these actions and
// stores at startup.
export {
  routeTaskWorkspaceEditViewAction,
  routeTaskWorkspaceTabAction,
} from "./useTaskWorkspaceTabNavigation";
export { useIssueDrawerWorkspaceStore } from "./internal/drawerWorkspaceStore";
export { closeTerminalTab } from "./closeTerminalTab";
