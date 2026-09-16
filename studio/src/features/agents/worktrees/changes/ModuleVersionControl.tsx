import { useQuery } from "@apollo/client/react";
import { useState } from "react";

import { studioApolloClient } from "../../../../shared/apollo/client";
import { ModuleVersionControlDocument } from "../generated/moduleVersionControl.documents";
import {
  commitModuleChanges,
  commitPushModuleChanges,
  createModulePullRequest,
  pushModuleChanges,
} from "../internal/changesTransport";
import { newOperationId } from "../internal/operationId";
import { ChangesActions } from "./ChangesActions";
import { ChangesFileReview } from "./ChangesFileReview";
import { CurrentWorktreesList } from "./CurrentWorktreesList";
import { modulePullRequestKey, useModulePullRequestState } from "./modulePullRequestState";

function baselineLabel(kind?: string | null, baseline?: string | null): string {
  if (!baseline) return "Comparison unavailable";
  if (kind === "default_merge_base") {
    return `Compared from the merge base with ${baseline}`;
  }
  if (kind === "upstream") return `Compared with upstream ${baseline}`;
  return `Compared with ${baseline}`;
}

export function ModuleVersionControl({
  moduleId,
  active,
  onOpenModule,
  onOpenTask,
}: {
  moduleId: string;
  active: boolean;
  onOpenModule: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const query = useQuery(ModuleVersionControlDocument, {
    client: studioApolloClient(),
    variables: { moduleId },
    skip: !active,
    fetchPolicy: "network-only",
  });
  const modulePullRequestUrls = useModulePullRequestState((state) => state.urls);
  const [lastCommit, setLastCommit] = useState<{
    subject: string;
    messageSource: string;
  } | null>(null);
  const result = query.data?.module_version_control;
  if (!active) return null;
  if (query.error) {
    return <div className="p-4 text-sm text-lifecycle-danger" role="alert">{query.error.message}</div>;
  }
  if (!result) {
    return <div className="p-4 text-sm text-text-muted">Loading module changes...</div>;
  }
  const checkout = result.checkout;
  const pullRequestKey = modulePullRequestKey(moduleId, checkout.branch);
  const modulePullRequestUrl = modulePullRequestUrls[pullRequestKey];

  return (
    <div
      className="grid h-full min-h-0 grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] text-sm"
      data-testid="module-version-control"
    >
      <div className="min-h-0 border-r border-pane-border">
        <CurrentWorktreesList
          rows={result.worktrees}
          truncated={result.worktrees_truncated}
          onOpenModule={onOpenModule}
          onOpenTask={onOpenTask}
        />
      </div>
      <section aria-label="Module checkout changes" className="flex min-h-0 flex-col overflow-hidden p-4">
        <header className="mb-3 shrink-0 border-b border-pane-border pb-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-medium text-text-primary">Module checkout Changes</h2>
            {checkout.branch ? (
              <span className="font-mono text-xs text-text-muted">{checkout.branch}</span>
            ) : null}
          </div>
          <p className="text-xs text-text-muted">
            {baselineLabel(checkout.baseline_kind, checkout.baseline)}
          </p>
          {checkout.available ? (
            <>
              <p className="text-xs text-text-muted">
                {checkout.dirty ? "Dirty" : "Clean"} · {checkout.unpushed_count ?? 0} unpushed
              </p>
              <ChangesActions
                stackKind="module"
                branch={checkout.branch}
                key={`${checkout.branch ?? "none"}:${checkout.default_branch ?? "none"}`}
                dirty={checkout.dirty === true}
                unpushedCount={checkout.unpushed_count ?? 0}
                commitDescription={
                  lastCommit
                    ? `Committed as ${lastCommit.subject} (${lastCommit.messageSource})`
                    : null
                }
                pullRequestUrl={modulePullRequestUrl}
                pullRequestCreationEligible={checkout.pull_request_creation_eligible}
                onCommit={async () => {
                  try {
                    const committed = await commitModuleChanges(moduleId, newOperationId());
                    setLastCommit({
                      subject: committed.subject,
                      messageSource: committed.message_source,
                    });
                  } finally {
                    await query.refetch();
                  }
                }}
                onPush={async () => {
                  try {
                    await pushModuleChanges(moduleId, newOperationId());
                  } finally {
                    await query.refetch();
                  }
                }}
                onStack={async () => commitPushModuleChanges(moduleId, newOperationId())}
                onCreatePullRequest={async () => {
                  const created = await createModulePullRequest(moduleId, newOperationId());
                  useModulePullRequestState.getState().remember(pullRequestKey, created.url);
                  await query.refetch().catch(() => undefined);
                  return created;
                }}
              />
            </>
          ) : null}
        </header>

        {!checkout.available ? (
          <div className="text-lifecycle-danger" role="status">
            {checkout.reason ?? "Module checkout unavailable."}
          </div>
        ) : checkout.files.length === 0 ? (
          <div className="text-text-muted">No module changes from the selected baseline.</div>
        ) : (
          <ChangesFileReview
            checkoutKey={`module:${moduleId}`}
            moduleId={moduleId}
            files={checkout.files}
            insertions={checkout.insertions}
            deletions={checkout.deletions}
            truncated={checkout.truncated}
            label="Module changed files"
          />
        )}
      </section>
    </div>
  );
}
