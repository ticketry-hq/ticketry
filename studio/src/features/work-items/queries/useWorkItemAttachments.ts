import { skipToken, useQuery } from "@apollo/client/react";

import { compactWorktrackerId, publicWorktrackerId } from "../../../shared/api/generatedWorktracker";
import type { Attachment } from "../attachmentView";
import { studioApolloClient } from "../../../shared/apollo/client";
import { WorkTrackerAttachmentsDocument } from "../generated/workItems.documents";

export function useWorkItemAttachments(id: string | null) {
  const query = useQuery(
    WorkTrackerAttachmentsDocument,
    id ? {
      client: studioApolloClient(),
      variables: { issueId: compactWorktrackerId(id) },
    } : skipToken,
  );
  const attachments: Attachment[] | undefined = query.data?.attachments.nodes.map(
    (attachment) => ({
      ...attachment,
      id: publicWorktrackerId(attachment.id),
      issue: publicWorktrackerId(attachment.issue_id),
      url: attachment.file,
    }),
  );

  return { ...query, data: attachments };
}
