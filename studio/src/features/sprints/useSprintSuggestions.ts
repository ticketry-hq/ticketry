import { useQuery } from "@apollo/client/react";
import { SprintSuggestionsDocument } from "./generated/sprints.documents";

export function useSprintSuggestions(sprintId: string | null) {
  const { data, loading, error } = useQuery(SprintSuggestionsDocument, {
    variables: { sprintId: sprintId ?? "" },
    skip: !sprintId,
  });
  return { suggestions: data?.worktrackerSprintSuggestion.nodes ?? [], loading, error };
}
