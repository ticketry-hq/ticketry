import { gql } from "@apollo/client";
import { useApolloClient, useMutation } from "@apollo/client/react";
import { useCallback, useState } from "react";
import type { CreateSprintOutcome } from "./sprintCreation";
import { PlanningGraphDocument, refreshPlanningGraph } from "../planning-graph";
import { refreshSprintChoices } from "./queries/refreshSprintChoices";
import {
  CreateSprintDocument,
  UpdateSprintDocument,
  type UpdateSprintMutationVariables,
} from "./generated/sprints.documents";

export function useCreateSprint(projectId: string) {
  const client = useApolloClient();
  const [mutate] = useMutation(CreateSprintDocument, {
    update: (_cache, result) => {
      if (result.data?.worktrackerSprintCreateOne) refreshSprintChoices(projectId);
    },
  });
  const [pendingCount, setPendingCount] = useState(0);
  const create = useCallback(async (name: string): Promise<CreateSprintOutcome> => {
    setPendingCount((count) => count + 1);
    try {
      const result = await mutate({ variables: { data: { projectId, name } } });
      const id = result.data?.worktrackerSprintCreateOne.id ?? null;
      const refresh = () => refreshPlanningGraph(client, projectId);
      try { await refresh(); }
      catch (cause) {
        if (id) return { kind: "refreshFailed", id, refresh,
          message: `Sprint created, but the view could not refresh: ${cause instanceof Error ? cause.message : "Try refreshing again."}` };
        throw cause;
      }
      return id ? { kind: "created", id } : { kind: "missing" };
    } finally { setPendingCount((count) => count - 1); }
  }, [client, mutate, projectId]);
  return { create, busy: pendingCount > 0 };
}

const SprintProjectFragment = gql`fragment SprintLifecycleProject on WorktrackerSprint { projectId }`;

export function useUpdateSprint(projectId?: string) {
  const [mutate, { loading }] = useMutation(UpdateSprintDocument, {
    update: (cache, result) => {
      const sprint = result.data?.update_sprint;
      if (!sprint) return;
      const cachedProjectId = cache.readFragment<{ projectId: string }>({
        id: cache.identify({ __typename: "WorktrackerSprint", id: sprint.id }), fragment: SprintProjectFragment,
      })?.projectId;
      const affectedProjectId = projectId ?? cachedProjectId;
      if (affectedProjectId) refreshSprintChoices(affectedProjectId);
    },
    refetchQueries: [PlanningGraphDocument],
    awaitRefetchQueries: true,
  });
  const update = useCallback(async (variables: UpdateSprintMutationVariables): Promise<boolean> => {
    await mutate({ variables });
    return true;
  }, [mutate]);
  return { update, busy: loading };
}

export { useUpdateSprintSuggestion } from "./useUpdateSprintSuggestion";
