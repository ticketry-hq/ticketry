// Shared per-task worktree controls (ticket #589, shared by CODIN-922).
// Public interface of the module — import only from here.
export { WorktreeBlock } from "./WorktreeBlock";
export type {
  WorktreeContext,
  WorktreeStatus,
  DiscardResult,
} from "./internal/types";
