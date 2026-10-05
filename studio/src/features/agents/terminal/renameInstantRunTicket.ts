import { gql } from "@apollo/client";
import { useMutation } from "@apollo/client/react";
import { studioApolloClient } from "../../../shared/apollo/client";
import { RenameInstantRunTicketDocument } from "./generated/renameInstantRunTicket.documents";

const AcceptedTitleFragment = gql`
  fragment RenamedInstantRunTicketTitle on InstantRunTicket {
    acceptedTitle @client
  }
`;

/** Rename one provider-owned Instant conversation and converge its cache row. */
export function useRenameInstantRunTicket() {
  return useMutation(RenameInstantRunTicketDocument, {
    client: studioApolloClient(),
    update: (cache, { data }, { variables }) => {
      if (!data?.title || !variables?.agentRunId) return;
      const agentRunId = cache.identify({
        __typename: "InstantRunTicket",
        agent_run_id: variables.agentRunId,
      });
      if (!agentRunId) return;
      cache.writeFragment({
        id: agentRunId,
        fragment: AcceptedTitleFragment,
        data: { acceptedTitle: data.title },
      });
    },
  });
}
