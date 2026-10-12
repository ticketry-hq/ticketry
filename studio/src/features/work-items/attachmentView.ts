import type { WorkTrackerAttachmentsQuery } from "./generated/workItems.documents";

type AttachmentRow = WorkTrackerAttachmentsQuery["attachments"]["nodes"][number];

/** Display view renames the generated issue/file fields for existing attachment UI. */
export type Attachment = Omit<AttachmentRow, "issue_id" | "file"> & {
  readonly issue: AttachmentRow["issue_id"];
  readonly url: AttachmentRow["file"];
};
