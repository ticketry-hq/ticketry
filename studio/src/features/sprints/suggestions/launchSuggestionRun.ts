import type { ApolloClient } from "@apollo/client";
import type { WorktrackerSprint } from "../../../graphql-foundation/generated/schemaTypes";
import { studioApolloClient } from "../../../shared/apollo/client";
import { CreateSprintSuggestionExecutionDocument } from "../generated/sprints.documents";

export type SuggestionSprint = Pick<WorktrackerSprint, "id" | "projectId">;

export async function launchSuggestionRun(
  sprint: SuggestionSprint,
  client: ApolloClient = studioApolloClient(),
): Promise<string> {
  const result = await client.mutate({
    mutation: CreateSprintSuggestionExecutionDocument,
    variables: {
      projectId: sprint.projectId,
      sprintId: sprint.id,
      clientRequestId: crypto.randomUUID(),
    },
    refetchQueries: ["SprintSuggestionExecution", "SprintSuggestionExecutionRun", "SprintSuggestions"],
    awaitRefetchQueries: true,
  });
  const execution = result.data?.agent_execution_create;
  if (!execution) throw new Error("The suggestion run could not be started.");
  return execution.agentRunId;
}
