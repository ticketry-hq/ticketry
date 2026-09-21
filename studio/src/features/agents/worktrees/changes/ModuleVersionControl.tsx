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
import { BranchInspector } from "./BranchInspector";
import { ChangesActionAlert } from "./ChangesActionAlert";
import { ChangesFileReview } from "./ChangesFileReview";
import { ChangesToolbar } from "./ChangesToolbar";
import { useChangesActions } from "./useChangesActions";
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
    fetchPolicy: "cache-and-network",
  });
  const modulePullRequestUrls = useModulePullRequestState((state) => state.urls);
  const [lastCommit, setLastCommit] = useState<{
    subject: string;
    messageSource: string;
  } | null>(null);
  const result = query.data?.module_version_control;
  const checkout = result?.checkout;
  const pullRequestKey = modulePullRequestKey(moduleId, checkout?.branch);
  const modulePullRequestUrl = modulePullRequestUrls[pullRequestKey];

  const actions = useChangesActions({
    stackKind: "module",
    branch: checkout?.branch,
    dirty: checkout?.dirty === true,
    unpushedCount: checkout?.unpushed_count ?? 0,
    commitDescription: lastCommit
      ? `Committed as ${lastCommit.subject} (${lastCommit.messageSource})`
      : null,
    pullRequestUrl: modulePullRequestUrl,
    pullRequestCreationEligible: checkout?.pull_request_creation_eligible,
    onCommit: async () => {
      try {
        const committed = await commitModuleChanges(moduleId, newOperationId());
        setLastCommit({ subject: committed.subject, messageSource: committed.message_source });
      } finally {
        await query.refetch();
      }
    },
    onPush: async () => {
      try {
        await pushModuleChanges(moduleId, newOperationId());
      } finally {
        await query.refetch();
      }
    },
    onStack: async () => {
      try {
        await commitPushModuleChanges(moduleId, newOperationId());
      } finally {
        await query.refetch();
      }
    },
    onCreatePullRequest: async () => {
      const created = await createModulePullRequest(moduleId, newOperationId());
      useModulePullRequestState.getState().remember(pullRequestKey, created.url);
      await query.refetch().catch(() => undefined);
      return created;
    },
  });

  if (!active) return null;

  const unavailable = checkout && !checkout.available;

  return (
    <div className="h-full min-h-0 text-sm" data-testid="module-version-control">
      <ChangesFileReview
        checkoutKey={`module:${moduleId}`}
        toolbar={(
          <>
            <ChangesToolbar
              actions={actions}
              moduleId={moduleId}
              selectedTaskId={null}
              onOpenModule={onOpenModule}
              onOpenTask={onOpenTask}
            />
            <ChangesActionAlert error={actions.error ?? query.error?.message} notice={actions.notice} />
          </>
        )}
        inspector={checkout ? (
          <BranchInspector
            actions={actions}
            branch={checkout.branch}
            baseline={baselineLabel(checkout.baseline_kind, checkout.baseline)}
            lastCommit={lastCommit ? `${lastCommit.subject} (${lastCommit.messageSource})` : null}
          />
        ) : null}
        header={checkout ? (
          <div className="px-3 pb-1">
            <h2 className="sr-only">Module checkout Changes</h2>
            <p className="text-xs text-text-muted">
              {baselineLabel(checkout.baseline_kind, checkout.baseline)}
            </p>
            {unavailable ? (
              <p className="text-lifecycle-danger" role="status">
                {checkout.reason ?? "Module checkout unavailable."}
              </p>
            ) : null}
          </div>
        ) : null}
        moduleId={moduleId}
        files={checkout?.available ? checkout.files : []}
        insertions={checkout?.insertions ?? 0}
        deletions={checkout?.deletions ?? 0}
        truncated={checkout?.truncated ?? false}
        label="Module changed files"
        loading={!checkout}
        emptyMessage={checkout?.available
          ? "No module changes from the selected baseline."
          : "Module checkout unavailable."}
      />
    </div>
  );
}
