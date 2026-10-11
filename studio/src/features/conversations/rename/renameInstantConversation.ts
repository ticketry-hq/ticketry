import { studioApolloClient } from "../../../shared/apollo/client";
import { writeCommittedConversationTitle } from "../../../shared/apollo/committedConversationTitle";
import { UpdateInstantConversationTitleDocument } from "../../agents/terminal";

/** Publish the authoritative user title to the shared conversation projection. */
export async function renameInstantConversation(agentRunId: string, title: string): Promise<void> {
  const client = studioApolloClient();
  const { data } = await client.mutate({
    mutation: UpdateInstantConversationTitleDocument,
    variables: { agentRunId, title },
  });
  const saved = data?.run;
  if (!saved?.conversationTitle || saved.id !== agentRunId) {
    throw new Error("The conversation title could not be saved.");
  }
  writeCommittedConversationTitle(client.cache, agentRunId, saved.conversationTitle);
}
