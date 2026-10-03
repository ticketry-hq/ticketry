import { useQuery } from "@apollo/client/react";
import { useMemo } from "react";

import { PlanningGraphDocument } from "./generated/planningGraph.documents";
import { adaptPlanningGraph, type PlanningGraph } from "./planningModel";

export interface PlanningGraphResult {
  graph: PlanningGraph | null;
  loading: boolean;
  error: string | null;
}

/** The project's planning graph, read once and shared through the cache. */
export function usePlanningGraph(projectId: string | null): PlanningGraphResult {
  const { data, loading, error } = useQuery(PlanningGraphDocument, {
    variables: { projectId: projectId ?? "" },
    skip: !projectId,
  });
  const graph = useMemo(() => (data ? adaptPlanningGraph(data) : null), [data]);
  return { graph, loading: loading && !data, error: error?.message ?? null };
}
