import { useCallback } from "react";
import { studioApolloClient } from "../../shared/apollo/client";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { PlanWorkItemDocument } from "./generated/workItems.documents";
import { claimPlanWrite, releasePlanWrite } from "./planWriteGuard";

export function usePlanWorkItem() {
  return useCallback(async (id: string, sprintId: string | null): Promise<boolean> => {
    if (!claimPlanWrite(id)) return false;
    try {
      const client = studioApolloClient();
      const cacheId = client.cache.identify({ __typename: "WorktrackerIssue", id });
      const optimisticId = `plan-assignment:${compactWorktrackerId(id)}`;
      if (cacheId) client.cache.recordOptimisticTransaction((cache) => {
        cache.modify({ id: cacheId, fields: { sprintId: () => sprintId } });
      }, optimisticId);
      try {
        const result = await client.mutate({ mutation: PlanWorkItemDocument,
          variables: { id: compactWorktrackerId(id), sprintId: sprintId ? compactWorktrackerId(sprintId) : null } });
        return Boolean(result.data?.update_work_item);
      } finally {
        client.cache.removeOptimistic(optimisticId);
      }
    } catch {
      return false;
    } finally {
      releasePlanWrite(id);
    }
  }, []);
}
