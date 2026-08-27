import { studioApolloClient } from "../../../shared/apollo/client";
import {
  ScratchResumableTerminalSessionsDocument,
  TaskResumableTerminalSessionsDocument,
} from "./generated/terminalSessions.documents";

const terminalHoldingDocuments = [
  TaskResumableTerminalSessionsDocument,
  ScratchResumableTerminalSessionsDocument,
] as const;

/** Refetch every mounted resumable-session holding from its original variables. */
export async function refreshTerminalHoldings(): Promise<void> {
  await studioApolloClient().refetchQueries({
    include: [...terminalHoldingDocuments],
  });
}
