import { useQuery } from "@apollo/client/react";
import { studioApolloClient } from "../../../shared/apollo/client";
import { InstantRunTicketsDocument } from "./generated/instantRunTickets.documents";

export interface InstantRunTicket {
  agentRunId: string;
  title: string;
  startedAt: string;
}

const EMPTY_TICKETS: InstantRunTicket[] = [];

/** Active taskless Instant conversations, projected as safe ticket rows. */
export function useInstantRunTickets(
  projectId: string | null,
  moduleId: string | null,
): InstantRunTicket[] {
  const query = useQuery(InstantRunTicketsDocument, {
    client: studioApolloClient(),
    variables: {
      projectId: projectId ?? "",
      moduleId: moduleId ?? "",
    },
    skip: !projectId || !moduleId,
  });
  return query.data?.tickets
    ? query.data.tickets.map((ticket) => ({
        agentRunId: ticket.agent_run_id,
        title: ticket.title,
        startedAt: ticket.started_at,
      }))
    : EMPTY_TICKETS;
}
