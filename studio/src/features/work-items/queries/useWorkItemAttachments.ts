import { skipToken, useQuery } from "@apollo/client/react";

import { compactWorktrackerId, publicWorktrackerId } from "../../../shared/api/generatedWorktracker";
import type { Attachment } from "../../../shared/api/types";
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
      id: publicWorktrackerId(attachment.id),
      issue: publicWorktrackerId(attachment.issue_id),
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      size: attachment.size,
      url: attachment.file,
      created_at: attachment.created_at,
    }),
  );

  return { ...query, data: attachments };
}
