import { useApolloClient, useMutation, useQuery } from "@apollo/client/react";
import { CreateSprintGoalDocument, DeleteSprintGoalDocument, SprintGoalsDocument } from "./generated/goals.documents";

export function useSprintGoals(sprintId: string) {
  const client = useApolloClient();
  const query = useQuery(SprintGoalsDocument, { variables: { sprintId } });
  const [create, creating] = useMutation(CreateSprintGoalDocument);
  const [remove, removing] = useMutation(DeleteSprintGoalDocument);
  const goals = query.data?.worktrackerSprintGoal.nodes ?? [];
  const refresh = () => {
    void client.refetchQueries({ include: ["SprintGoals", "SprintSuggestionExecution"] }).catch(() => {});
  };
  async function createGoal(text: string) {
    const position = Math.max(0, ...goals.map((goal) => goal.position)) + 1;
    const optimisticGoal = { __typename: "WorktrackerSprintGoal", id: `pending-goal:${sprintId}`, text, position };
    const result = await create({
      variables: { sprintId, text },
      optimisticResponse: { create_sprint_goal: optimisticGoal },
      update(cache, result) {
        const goal = result.data?.create_sprint_goal;
        if (!goal) return;
        cache.updateQuery({ query: SprintGoalsDocument, variables: { sprintId } }, (cached) => cached && ({
          worktrackerSprintGoal: { ...cached.worktrackerSprintGoal,
            nodes: [...cached.worktrackerSprintGoal.nodes.filter((row) => row.id !== goal.id), goal],
          },
        }));
      },
    });
    if (!result.data?.create_sprint_goal) throw new Error("The goal was not saved. Try again.");
    refresh();
  }
  async function deleteGoal(id: string) {
    const result = await remove({ variables: { id }, update(cache, response) {
      if (!response.data?.delete_sprint_goal) return;
      cache.updateQuery({ query: SprintGoalsDocument, variables: { sprintId } }, (cached) => cached && ({
        worktrackerSprintGoal: { ...cached.worktrackerSprintGoal,
          nodes: cached.worktrackerSprintGoal.nodes.filter((goal) => goal.id !== id),
        },
      }));
    } });
    if (!result.data?.delete_sprint_goal) throw new Error("The goal was not removed. Try again.");
    refresh();
  }
  return { goals, loading: query.loading, error: query.error?.message,
    busy: creating.loading || removing.loading, createGoal, deleteGoal, refetch: query.refetch };
}
