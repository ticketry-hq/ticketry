// Shared per-task worktree controls (ticket #589, shared by CODIN-922).
// Public interface of the module — import only from here.
export { WorktreeBlock } from "./WorktreeBlock";
export { TaskWorktreeChanges } from "./changes/TaskWorktreeChanges";
export { ModuleVersionControl } from "./changes/ModuleVersionControl";
export { ChangesWorkspace } from "./changes/ChangesWorkspace";
export {
  dismissChangesWorkspace,
  leaveChangesWorkspace,
  openChangesWorkspace,
  openModuleChangesWorkspace,
  openTaskChangesWorkspace,
  selectChangesCheckout,
  useChangesWorkspace,
} from "./changes/changesWorkspaceState";
export {
  useHasTaskWorktree,
  useTaskWorktreeAvailability,
  type TaskWorktreeAvailability,
} from "./queries/useHasTaskWorktree";
export type { WorktreeStatus, DiscardResult } from "./internal/types";
export { WorktreeChangesDocument } from "./generated/worktreeChanges.documents";
export { WorktreeFileDiffDocument } from "./generated/worktreeFileDiff.documents";
export { ModuleFileDiffDocument } from "./generated/moduleFileDiff.documents";
