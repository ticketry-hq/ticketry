import type {
  ActionStep as ApiActionStep,
  ChangedFile as ApiChangedFile,
  FileDiff as ApiFileDiff,
  WorktreeChanges as ApiWorktreeChanges,
  WorktreeCommit as ApiWorktreeCommit,
  WorktreeCommitPush as ApiWorktreeCommitPush,
  WorktreePullRequest as ApiWorktreePullRequest,
  WorktreePushPreview as ApiWorktreePushPreview,
} from "@worktracker/typescript-sdk/models";

/** One path the checkout changes, as the review surface presents it. */
export type ChangedFileStatus =
  | "untracked"
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "conflicted";

export type ChangedFile = Omit<ApiChangedFile, "status"> & {
  status: ChangedFileStatus;
};

export interface PullRequestVerdict {
  url: string;
  number: number | null;
  state: "OPEN" | "MERGED" | "CLOSED";
}

/**
 * Discriminated on `kind`: a readable checkout, or nothing to review yet.
 *
 * `checkout` says which kind of checkout answered, and only that kind's
 * identifiers are filled in — a worktree answer never carries a module id and
 * a module answer never carries a task id.
 */
export type WorktreeChanges = Omit<
  ApiWorktreeChanges,
  "kind" | "checkout" | "files" | "pull_request"
> & {
  kind: "changes" | "no_worktree" | "no_checkout";
  checkout: CheckoutKind;
  files: ChangedFile[];
  pull_request?: PullRequestVerdict | null;
};

export type FileDiff = ApiFileDiff;

export type CheckoutKind = "worktree" | "module";

/**
 * Which checkout a review read is about.
 *
 * Every query key, request, and invalidation is built from one of these, so
 * the identity is carried rather than inferred and the two kinds can never
 * share a cache entry or a command.
 */
export type CheckoutRef = WorktreeCheckoutRef | ModuleCheckoutRef;

export interface WorktreeCheckoutRef {
  kind: "worktree";
  taskId: string;
  parentId: string | null;
  moduleId: string | null;
}

export interface ModuleCheckoutRef {
  kind: "module";
  moduleId: string;
}

/** Identifies which task's worktree a review read is about. */
export interface WorktreeChangesContext {
  parentId?: string | null;
  moduleId?: string | null;
}

export function worktreeCheckout(
  taskId: string,
  context: WorktreeChangesContext = {},
): WorktreeCheckoutRef {
  return {
    kind: "worktree",
    taskId,
    parentId: context.parentId ?? null,
    moduleId: context.moduleId ?? null,
  };
}

export function moduleCheckout(moduleId: string): ModuleCheckoutRef {
  return { kind: "module", moduleId };
}

/** The steps a stacked action runs, in the only order they ever run. */
export type ActionStepName =
  | "stage"
  | "generate_message"
  | "commit"
  | "push"
  | "pull_request";

/**
 * What a step reports once it has settled.
 *
 * `running` is deliberately absent: a synchronous response can only describe
 * steps that already finished, so the footer supplies that state itself for
 * the steps it has not heard about yet.
 */
export type ActionStepStatus = "ok" | "skipped" | "failed";

export type ActionStep = Omit<ApiActionStep, "name" | "status"> & {
  name: ActionStepName;
  status: ActionStepStatus;
};

/** The commit-only action's result. Discriminated on `status`. */
export type CommitOutcome = Omit<
  ApiWorktreeCommit,
  "status" | "steps" | "commit_shas" | "action_id" | "ship_record"
> & {
  status: "committed" | "nothing_to_commit";
  steps: ActionStep[];
  commit_shas?: string[];
  action_id?: string;
  ship_record?: ApiWorktreeCommit["ship_record"];
};

/**
 * The commit-and-push action's result. Discriminated on `status`.
 *
 * `push_failed` arrives as a success response, not an error: the commit before
 * the push may well have landed, and `commit_sha` is the only record of it.
 */
export type CommitPushStatus =
  | "committed_and_pushed"
  | "pushed"
  | "up_to_date"
  | "push_failed";

export type CommitPushOutcome = Omit<
  ApiWorktreeCommitPush,
  | "status"
  | "steps"
  | "failure_code"
  | "commit_shas"
  | "action_id"
  | "ship_record"
> & {
  status: CommitPushStatus;
  steps: ActionStep[];
  failure_code: "diverged" | "rejected" | null;
  commit_shas?: string[];
  action_id?: string;
  ship_record?: ApiWorktreeCommitPush["ship_record"];
};

/** Whether the push can run at all, and why not when it cannot. */
export type PushPreviewState =
  | "ready"
  | "up_to_date"
  | "diverged"
  | "detached_head"
  | "unborn_branch"
  | "no_remote";

/**
 * What the confirmation step shows before anything leaves the machine.
 *
 * Branch, remote, and commit count — and no generated commit text, which the
 * shape cannot carry because the message is written inside the action, after
 * this read.
 */
export type PushPreview = Omit<ApiWorktreePushPreview, "state"> & {
  state: PushPreviewState;
};

/**
 * The pull-request action's result. Discriminated on `status`.
 *
 * `push_failed` and `pull_request_failed` both arrive as success responses, for
 * the same reason `push_failed` does on the commit-and-push action: a commit
 * that already landed and a branch that was already published are worth
 * reporting, and an error envelope would carry neither.
 */
export type PullRequestStatus =
  | "opened"
  | "already_open"
  | "push_failed"
  | "pull_request_failed";

export type PullRequestOutcome = Omit<
  ApiWorktreePullRequest,
  | "status"
  | "steps"
  | "failure_code"
  | "commit_shas"
  | "action_id"
  | "ship_record"
> & {
  status: PullRequestStatus;
  steps: ActionStep[];
  failure_code: "diverged" | "rejected" | null;
  commit_shas?: string[];
  action_id?: string;
  ship_record?: ApiWorktreePullRequest["ship_record"];
};
