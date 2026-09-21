import { useQuery } from "@apollo/client/react";

import { compactWorktrackerId } from "../../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../../shared/apollo/client";
import { CurrentWorktreesDocument } from "../generated/currentWorktrees.documents";
import { withCheckoutStatus, type WorktreeCheckoutRow } from "./worktreeCheckoutRows";

const MAX_ROWS = 100;

export function useWorktreeCheckouts(moduleId?: string | null): {
  rows: readonly WorktreeCheckoutRow[];
  loading: boolean;
  failed: boolean;
  truncated: boolean;
} {
  const compactModuleId = compactWorktrackerId(moduleId ?? "");
  const query = useQuery(CurrentWorktreesDocument, {
    client: studioApolloClient(), variables: { moduleId: compactModuleId }, skip: !moduleId, fetchPolicy: "cache-first",
  });
  const nodes = (query.data ?? query.previousData)?.worktrees.nodes;
  const rows = [
    withCheckoutStatus({ taskId: null, label: "Module checkout", branch: null }),
    ...(nodes ?? []).slice(0, MAX_ROWS).map((node) => withCheckoutStatus({
      taskId: node.taskId,
      label: node.issue ? `${node.project?.slug ?? "Work Item"}-${node.issue.sequenceId} ${node.issue.name}` : node.branch,
      branch: node.branch,
    })),
  ];
  return {
    rows,
    loading: !nodes && !query.error,
    failed: Boolean(query.error),
    truncated: (nodes?.length ?? 0) > MAX_ROWS,
  };
}
