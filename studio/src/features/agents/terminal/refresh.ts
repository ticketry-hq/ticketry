import { studioApolloClient } from "../../../shared/apollo/client";
import { documentOperationName } from "../../../graphql-foundation/typedDocument";
import {
  ScratchResumableTerminalSessionsDocument,
  TaskResumableTerminalSessionsDocument,
} from "./generated/terminalSessions.documents";
import { InstantRunTicketsDocument } from "./generated/instantRunTickets.documents";

const instantRunTicketsOperationName = documentOperationName(
  InstantRunTicketsDocument,
);
const taskResumableOperationName = documentOperationName(
  TaskResumableTerminalSessionsDocument,
);
const scratchResumableOperationName = documentOperationName(
  ScratchResumableTerminalSessionsDocument,
);

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Refetch every mounted resumable-session holding from its original variables. */
export async function refreshTerminalHoldings(): Promise<void> {
  const client = studioApolloClient();
  const holdings = [...client.getObservableQueries("all")].filter(
    (observableQuery) => {
      const operationName = documentOperationName(observableQuery.options.query);
      const variables = observableQuery.variables as Record<string, unknown>;
      if (operationName === taskResumableOperationName) {
        return hasText(variables.taskId);
      }
      if (
        operationName === scratchResumableOperationName ||
        operationName === instantRunTicketsOperationName
      ) {
        return hasText(variables.projectId) && hasText(variables.moduleId);
      }
      return false;
    },
  );
  await Promise.all(holdings.map((holding) => holding.refetch()));
}
