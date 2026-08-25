// Shared per-task worktree controls (ticket #589, shared by CODIN-922).
// Public interface of the module — import only from here.
export { WorktreeBlock } from "./WorktreeBlock";
export { FooterWorktreesToggle } from "./FooterWorktreesToggle";
export { invalidateTaskWorktree } from "./queries";
export type { WorktreeRevealRuntime } from "./OpenWorktreeInFinder";
export type {
  WorktreeContext,
  WorktreeStatus,
  DiscardResult,
} from "./internal/api";
