/** Narrow startup entry for routing into the currently rendered workspace. */
export {
  routeTaskWorkspaceEditViewAction,
  routeTaskWorkspaceTabAction,
} from "./internal/useTaskWorkspaceTabNavigation";
export type {
  WorkspaceTabActionId,
  EditViewWorkspaceActionId,
  EditViewWorkspaceActionOutcome,
} from "./internal/useTaskWorkspaceTabNavigation";
export { closeTerminalTab } from "./internal/closeTerminalTab";
