import {
  TaskWorkspace,
  type TaskWorkspaceProps,
} from "../../../../features/task-workspace";

export type {
  ScratchLaunchMode,
  TicketLaunchContext,
  WorkspaceLauncherContext,
} from "../../../../features/task-workspace";

/** Shell adapter: supplies host identity, presentation authority and entry intent. */
export function SelectedTicketContent(props: TaskWorkspaceProps) {
  return <TaskWorkspace {...props} />;
}
