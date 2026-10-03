import { useMutation } from "@apollo/client/react";
import { useCallback } from "react";
import { PlanningGraphDocument } from "../planning-graph";
import { CreateSprintDocument, UpdateSprintDocument, type UpdateSprintMutationVariables } from "./generated/sprints.documents";

export function useCreateSprint(projectId: string) {
  const [mutate, { loading }] = useMutation(CreateSprintDocument, {
    refetchQueries: [PlanningGraphDocument],
    awaitRefetchQueries: true,
  });
  const create = useCallback(async (name: string): Promise<string | null> => {
    const result = await mutate({ variables: { data: { projectId, name } } });
    return result.data?.worktrackerSprintCreateOne.id ?? null;
  }, [mutate, projectId]);
  return { create, busy: loading };
}

export function useUpdateSprint() {
  const [mutate, { loading }] = useMutation(UpdateSprintDocument, {
    refetchQueries: [PlanningGraphDocument],
    awaitRefetchQueries: true,
  });
  const update = useCallback(async (variables: UpdateSprintMutationVariables): Promise<boolean> => {
    await mutate({ variables });
    return true;
  }, [mutate]);
  return { update, busy: loading };
}
