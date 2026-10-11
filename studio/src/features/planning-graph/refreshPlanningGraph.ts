import type { ApolloClient } from "@apollo/client";

import { PlanningGraphDocument, type PlanningGraphQuery } from "./generated/planningGraph.documents";

const readsByClient = new WeakMap<object, Map<string, { started: number; cached: number }>>();

function readsOf(client: object, projectId: string) {
  let projects = readsByClient.get(client);
  if (!projects) readsByClient.set(client, (projects = new Map()));
  let reads = projects.get(projectId);
  if (!reads) projects.set(projectId, (reads = { started: 0, cached: 0 }));
  return reads;
}

/** Fetch after a write without allowing an older overlapping response to replace a newer graph. */
export async function refreshPlanningGraph(client: ApolloClient, projectId: string, options: { shouldApply?: () => boolean; onRead?: (data: PlanningGraphQuery) => void } = {}): Promise<void> {
  const reads = readsOf(client, projectId);
  const order = ++reads.started;
  const { data } = await client.query({
    query: PlanningGraphDocument,
    variables: { projectId },
    fetchPolicy: "no-cache",
    context: { queryDeduplication: false },
  });
  if (!data) throw new Error("The server returned no planning graph.");
  options.onRead?.(data);
  if (order < reads.cached || options.shouldApply?.() === false) return;
  reads.cached = order;
  client.writeQuery({ query: PlanningGraphDocument, variables: { projectId }, data });
}
