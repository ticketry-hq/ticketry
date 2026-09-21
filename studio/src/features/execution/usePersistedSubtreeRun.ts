import { skipToken, useQuery } from "@apollo/client/react";
import { useCallback } from "react";
import {
  isLiveAgentRunState,
  projectRunPresentation,
  useAgentStatusSelection,
  type RunPresentationState,
  type RunRecord,
} from "../agents/status";
import { studioApolloClient } from "../../shared/apollo/client";
import { ExecutionGraphRunHoldingDocument } from "./generated/graphRuns.documents";

export interface ActiveSubtreeRun {
  runId: string;
  state: RunPresentationState;
}

function startedDuringCampaign(run: RunRecord, campaignUpdatedAt: string): boolean {
  if (!run.started_at) return false;
  const parseTimestamp = (value: string) => Date.parse(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`,
  );
  const startedAt = parseTimestamp(run.started_at);
  const campaignAt = parseTimestamp(campaignUpdatedAt);
  return Number.isFinite(startedAt) && Number.isFinite(campaignAt) && startedAt >= campaignAt;
}

export function usePersistedSubtreeRun(
  rootId: string | null,
  descendantTaskIds: readonly string[],
) {
  const query = useQuery(
    ExecutionGraphRunHoldingDocument,
    rootId
      ? {
          variables: { rootId },
          client: studioApolloClient(),
          fetchPolicy: "cache-and-network",
        }
      : skipToken,
  );
  const campaign = query.data?.graph_run_holding.nodes[0] ?? null;
  const activeRun = useAgentStatusSelection((holding): ActiveSubtreeRun | null => {
    if (!campaign) return null;
    const descendants = new Set(descendantTaskIds);
    return Object.values(holding.runs)
      .filter((run) => run.task_id !== null && descendants.has(run.task_id))
      .filter((run) => startedDuringCampaign(run, campaign.updated_at))
      .flatMap((run) => {
        const state = projectRunPresentation(run);
        return isLiveAgentRunState(state)
          ? [{ runId: run.agent_run_id, state, updatedAt: run.updated_at }]
          : [];
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  });
  const refresh = useCallback(async () => {
    if (rootId) await query.refetch();
  }, [query, rootId]);

  return {
    activeRun,
    loading: Boolean(rootId) && query.loading && query.data === undefined,
    refresh,
  };
}
