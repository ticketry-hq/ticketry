import { useQuery } from "@apollo/client/react";

import { studioApolloClient } from "../../../../shared/apollo/client";
import { compactWorktrackerId } from "../../../../shared/api/generatedWorktracker";
import { CurrentWorktreesDocument } from "../generated/currentWorktrees.documents";
import { ModuleVersionControlDocument } from "../generated/moduleVersionControl.documents";
import {
  withCheckoutStatus,
  type WorktreeCheckoutRow,
  type WorktreeCheckoutStatus,
} from "./worktreeCheckoutRows";

export interface WorktreeCheckouts {
  rows: readonly WorktreeCheckoutRow[];
  loading: boolean;
  failed: boolean;
  truncated: boolean;
}

const MAX_ROWS = 100;

/**
 * Every checkout in the module, with live state where it is already known.
 *
 * Identity comes from the cheap cached worktree list so the switcher fills
 * before module files finish loading. Live Git state is read from the module
 * Changes view that is already in the cache — never fetched for the switcher
 * alone, because that view also computes the module checkout diff.
 */
export function useWorktreeCheckouts(moduleId?: string | null): WorktreeCheckouts {
  const compactModuleId = compactWorktrackerId(moduleId ?? "");
  const query = useQuery(CurrentWorktreesDocument, {
    client: studioApolloClient(),
    variables: { moduleId: compactModuleId },
    skip: !moduleId,
    fetchPolicy: "cache-first",
  });
  const statusQuery = useQuery(ModuleVersionControlDocument, {
    client: studioApolloClient(),
    variables: { moduleId: compactModuleId },
    skip: !moduleId,
    fetchPolicy: "cache-only",
  });

  const statusByTask = new Map<string, WorktreeCheckoutStatus>();
  for (const status of statusQuery.data?.module_version_control.worktrees ?? []) {
    statusByTask.set(
      status.kind === "module" ? "module" : compactWorktrackerId(status.task_id ?? ""),
      status,
    );
  }

  const nodes = (query.data ?? query.previousData)?.worktrees.nodes;
  const rows: WorktreeCheckoutRow[] = [
    withCheckoutStatus(
      { taskId: null, label: "Module checkout", branch: null },
      statusByTask.get("module"),
    ),
    ...(nodes ?? []).slice(0, MAX_ROWS).map((node) => withCheckoutStatus(
      {
        taskId: node.taskId,
        label: node.issue
          ? `${node.project?.slug ?? "Work Item"}-${node.issue.sequenceId} ${node.issue.name}`
          : node.branch,
        branch: node.branch,
      },
      statusByTask.get(compactWorktrackerId(node.taskId)),
    )),
  ];

  return {
    rows,
    loading: !nodes && !query.error,
    failed: Boolean(query.error),
    truncated: (nodes?.length ?? 0) > MAX_ROWS,
  };
}
