// Shared per-task worktree controls (ticket #589, shared by CODIN-922).
// Public interface of the module — import only from here.
export { WorktreeBlock } from "./WorktreeBlock";
export { TaskWorktreeChanges } from "./changes/TaskWorktreeChanges";
export { ModuleVersionControl } from "./changes/ModuleVersionControl";
export {
  useHasTaskWorktree,
  useTaskWorktreeAvailability,
  type TaskWorktreeAvailability,
} from "./queries/useHasTaskWorktree";
export type {
  WorktreeContext,
  WorktreeStatus,
  DiscardResult,
} from "./internal/types";
