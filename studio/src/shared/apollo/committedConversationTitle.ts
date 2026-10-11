import { gql, type ApolloCache } from "@apollo/client";

const committedTitleFragment = gql`
  fragment CommittedConversationTitle on InstantRunTicket {
    title
    user_title
    committedTitleGeneration @client
  }
`;

/** Publish a successful save and its generation together in Apollo's base row. */
export function writeCommittedConversationTitle(
  cache: ApolloCache,
  agentRunId: string,
  title: string,
): void {
  const id = cache.identify({ __typename: "InstantRunTicket", agent_run_id: agentRunId });
  if (!id) return;
  const previous = cache.readFragment<{ committedTitleGeneration?: number }>({
    id,
    fragment: committedTitleFragment,
    optimistic: false,
    returnPartialData: true,
  });
  cache.writeFragment({
    id,
    fragment: committedTitleFragment,
    data: {
      __typename: "InstantRunTicket",
      title,
      user_title: title,
      committedTitleGeneration: (previous?.committedTitleGeneration ?? 0) + 1,
    },
  });
}
