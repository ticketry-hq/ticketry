export interface WorktreeStatus {
  kind: "worktree" | "no_repo" | "none";
  task_id: string;
  top_level_task_id: string;
  is_shared: boolean;
  branch?: string | null;
  base_branch?: string | null;
  path?: string | null;
  state?: string | null;
  clean?: boolean | null;
  dirty?: boolean | null;
  ahead?: number | null;
  behind?: number | null;
  conflict?: boolean | null;
  checkout_present?: boolean | null;
  ephemeral?: boolean;
  reason?: string | null;
}

export interface DiscardResult {
  removed: boolean;
  reason: string;
  status?: WorktreeStatus;
}

export interface WorktreeContext {
  parentId?: string | null;
  moduleId?: string | null;
  projectId?: string | null;
  ticketSeq?: number | null;
  taskName?: string | null;
}
