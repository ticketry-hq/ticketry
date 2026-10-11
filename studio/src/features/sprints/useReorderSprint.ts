import { useApolloClient, useMutation } from "@apollo/client/react";
import { useCallback } from "react";
import { refreshPlanningGraph } from "../planning-graph";
import { ReorderSprintDocument } from "./generated/sprints.documents";
import { refreshSprintChoices } from "./queries/refreshSprintChoices";
import type { SprintReorder } from "./SprintReorderControls";

export function useReorderSprint(projectId: string) {
  const client = useApolloClient();
  const [mutate, { loading }] = useMutation(ReorderSprintDocument, {
    update: (_cache, result) => {
      if (result.data?.reorder_sprint) refreshSprintChoices(projectId);
    },
  });
  const reorder = useCallback(async (variables: SprintReorder): Promise<void> => {
    const result = await mutate({ variables });
    if (!result.data?.reorder_sprint) throw new Error("Sprint could not be reordered. Try again.");
    try { await refreshPlanningGraph(client, projectId); }
    catch (cause) {
      throw new Error(`Sprint moved, but the view could not refresh: ${cause instanceof Error ? cause.message : "Try refreshing again."}`);
    }
  }, [client, mutate, projectId]);
  return { reorder, busy: loading };
}
