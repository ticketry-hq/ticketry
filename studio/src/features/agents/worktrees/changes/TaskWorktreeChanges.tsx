import { useQuery } from "@apollo/client/react";
import { useState } from "react";

import { studioApolloClient } from "../../../../shared/apollo/client";
import { WorktreeChangesDocument } from "../generated/worktreeChanges.documents";
import { WorktreeMergePreviewDocument } from "../generated/worktreeMergePreview.documents";
import { WorktreeStatusDocument } from "../generated/worktreeStatus.documents";
import { ModuleVersionControlDocument } from "../generated/moduleVersionControl.documents";
import {
  commitTaskChanges,
  commitPushTaskChanges,
  cleanupTaskWorktree,
  createTaskPullRequest,
  followUpTaskPullRequest,
  prepareTaskPullRequestMerge,
  pushTaskChanges,
  replaceTaskPullRequest,
} from "../internal/changesTransport";
import { newOperationId } from "../internal/operationId";
import { ChangesActions } from "./ChangesActions";
import { ChangesFileReview } from "./ChangesFileReview";
import { CurrentWorktreesList } from "./CurrentWorktreesList";
import { WorktreeMergePreview } from "./WorktreeMergePreview";
import { WorktreeLifecycle } from "./WorktreeLifecycle";

export function TaskWorktreeChanges({
  taskId,
  moduleId = null,
  active,
  onOpenModule = () => undefined,
  onOpenTask = () => undefined,
}: {
  taskId: string;
  moduleId?: string | null;
  active: boolean;
  onOpenModule?: () => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const query = useQuery(WorktreeChangesDocument, {
    client: studioApolloClient(),
    variables: { taskId },
    skip: !active,
    fetchPolicy: "network-only",
  });
  const changes = query.data?.worktree_changes;
  const moduleQuery = useQuery(ModuleVersionControlDocument, {
    client: studioApolloClient(),
    variables: { moduleId: moduleId ?? "" },
    skip: !active || !moduleId,
    fetchPolicy: "cache-and-network",
  });
  const [lastCommit, setLastCommit] = useState<{
    subject: string;
    messageSource: string;
  } | null>(null);

  const runThenRefresh = async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } finally {
      await studioApolloClient().refetchQueries({
        include: [WorktreeChangesDocument, WorktreeMergePreviewDocument],
      }).catch(() => undefined);
    }
  };

  if (!active) return null;

  if (query.error) {
    return (
      <div className="p-4 text-sm text-lifecycle-danger" role="alert">
        {query.error.message}
      </div>
    );
  }

  const checkouts = !moduleId ? (
    <p className="p-3 text-sm text-text-muted">Worktree checkouts unavailable.</p>
  ) : moduleQuery.error ? (
    <p className="p-3 text-sm text-lifecycle-danger" role="alert">Unable to load worktree checkouts.</p>
  ) : moduleQuery.data ? (
    <CurrentWorktreesList
      rows={moduleQuery.data.module_version_control.worktrees}
      truncated={moduleQuery.data.module_version_control.worktrees_truncated}
      selectedTaskId={taskId}
      onOpenModule={onOpenModule}
      onOpenTask={onOpenTask}
    />
  ) : (
    <p className="p-3 text-sm text-text-muted">Loading worktree checkouts...</p>
  );

  if (!changes) {
    return (
      <div
        aria-label="Task worktree changes"
        className="h-full min-h-0 text-sm"
        data-testid="task-worktree-changes"
      >
        <ChangesFileReview
          checkoutKey={`task:${taskId}`}
          checkouts={checkouts}
          header={null}
          taskId={taskId}
          files={[]}
          insertions={0}
          deletions={0}
          truncated={false}
          label="Cumulative changed files"
          emptyMessage="Loading changes..."
        />
      </div>
    );
  }

  const runPullRequestThenRefresh = async (
    action: () => Promise<{ url: string }>,
  ): Promise<{ url: string }> => {
    const created = await action();
    studioApolloClient().writeQuery({
      query: WorktreeChangesDocument,
      variables: { taskId },
      data: {
        worktree_changes: {
          ...changes,
          pull_request_url: created.url,
          pull_request_creation_eligible: false,
          pull_request: {
            ...changes.pull_request,
            url: created.url,
            state: "unavailable",
            target_branch: null,
            head_commit: null,
            integrated: false,
            post_merge_work: false,
            replacement_eligible: false,
            follow_up_eligible: false,
            merge_preparation_eligible: false,
            reason: "Refresh pull-request status before another lifecycle action.",
          },
        },
      },
    });
    await query.refetch().catch(() => undefined);
    return created;
  };

  return (
    <div
      aria-label="Task worktree changes"
      className="h-full min-h-0 text-sm"
      data-testid="task-worktree-changes"
    >
      <ChangesFileReview
        checkoutKey={`task:${taskId}`}
        checkouts={checkouts}
        header={(
          <header className="mb-3 border-b border-pane-border pb-3">
            <div className="font-medium text-text-primary">{changes.files.length} cumulative changes</div>
            <div className="text-xs text-text-muted">Includes committed work from the recorded base.</div>
            <ChangesActions
              branch={changes.pull_request?.target_branch ?? null}
              stackKind="task"
              dirty={changes.dirty}
              unpushedCount={changes.unpushed_count}
              commitDescription={lastCommit ? `Committed as ${lastCommit.subject} (${lastCommit.messageSource})` : null}
              pullRequestUrl={changes.pull_request_url}
              pullRequestCreationEligible={changes.pull_request_creation_eligible}
              pullRequest={changes.pull_request}
              onCommit={async () => {
                await runThenRefresh(async () => {
                  const committed = await commitTaskChanges(taskId, newOperationId());
                  setLastCommit({ subject: committed.subject, messageSource: committed.message_source });
                });
              }}
              onPush={async () => {
                await runThenRefresh(async () => {
                  await pushTaskChanges(taskId, newOperationId());
                });
              }}
              onStack={async () => commitPushTaskChanges(taskId, newOperationId())}
              onCreatePullRequest={() => runPullRequestThenRefresh(() => createTaskPullRequest(taskId, newOperationId()))}
              onReplacePullRequest={() => runPullRequestThenRefresh(() => replaceTaskPullRequest(taskId, newOperationId()))}
              onFollowUpPullRequest={() => runPullRequestThenRefresh(() => followUpTaskPullRequest(taskId, newOperationId()))}
              onPrepareMerge={async () => {
                await runThenRefresh(async () => {
                  await prepareTaskPullRequestMerge(taskId, newOperationId());
                });
              }}
            />
            <WorktreeLifecycle
              closureFailure={changes.closure_failure}
              cleanup={changes.cleanup}
              onCleanup={async (operationId) => {
                const status = await cleanupTaskWorktree(taskId, operationId);
                studioApolloClient().writeQuery({
                  query: WorktreeStatusDocument,
                  variables: { taskId },
                  data: { worktree_status: status },
                });
              }}
            />
            <WorktreeMergePreview taskId={taskId} active={active} />
          </header>
        )}
        taskId={taskId}
        files={changes.files}
        insertions={changes.insertions}
        deletions={changes.deletions}
        truncated={changes.truncated}
        label="Cumulative changed files"
        emptyMessage="No cumulative changes from the recorded base."
      />
    </div>
  );
}
