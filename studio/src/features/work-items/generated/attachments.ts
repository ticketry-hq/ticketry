// Generated from operations/workItems.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

export interface WorkTrackerAttachmentRow { readonly id: string; readonly issue_id: string; readonly file: string; readonly filename: string; readonly mime_type: string; readonly size: number | null; readonly created_at: string }
export interface WorkTrackerAttachmentsQuery { readonly attachments: { readonly nodes: ReadonlyArray<WorkTrackerAttachmentRow> } }
export interface WorkTrackerAttachmentsVariables { readonly issueId: string }
export const WorkTrackerAttachmentsDocument: TypedDocumentNode<WorkTrackerAttachmentsQuery, WorkTrackerAttachmentsVariables> = { kind: "Document", operationName: "WorkTrackerAttachments", source: "query WorkTrackerAttachments($issueId: String!) {\n  attachments: worktrackerAttachment(filters: { issueId: { eq: $issueId } }) {\n    nodes {\n      id\n      issue_id: issueId\n      file\n      filename\n      mime_type: mimeType\n      size\n      created_at: createdAt\n    }\n  }\n}" };
