import { skipToken, useQuery } from "@apollo/client/react";

import { compactWorktrackerId, publicWorktrackerId } from "../../../shared/api/generatedWorktracker";
import type { Attachment } from "../../../shared/api/types";
import { studioApolloClient } from "../../../shared/apollo/client";
import { useDelayedSelectionId } from "../../../shared/selection/useDelayedSelectionId";
import { WorkTrackerAttachmentsDocument } from "../generated/workItems.documents";

interface WorkItemAttachmentsOptions {
  delayMs?: number;
}

export function useWorkItemAttachments(
  id: string | null,
  { delayMs = 0 }: WorkItemAttachmentsOptions = {},
) {
  const queryId = useDelayedSelectionId(id, delayMs);
  const query = useQuery(
    WorkTrackerAttachmentsDocument,
    queryId ? {
      client: studioApolloClient(),
      variables: { issueId: compactWorktrackerId(queryId) },
    } : skipToken,
  );
  const attachments: Attachment[] | undefined = queryId === id
    ? query.data?.attachments.nodes.map((attachment) => ({
        id: publicWorktrackerId(attachment.id),
        issue: publicWorktrackerId(attachment.issue_id),
        filename: attachment.filename,
        mime_type: attachment.mime_type,
        size: attachment.size,
        url: attachment.file,
        created_at: attachment.created_at,
      }))
    : undefined;

  return { ...query, data: attachments };
}
