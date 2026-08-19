import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/// The worktree block's status, creation, and discard contracts. Generation
/// fails when the schema stops publishing any authored operation, so a renamed
/// or removed field is a build error rather than a silently empty panel, a
/// create button that cannot create, or a discard that cannot discard.
export async function generateWorktreeOperations({ schemaPath, sourceRoot, outputRoot }) {
  const schema = await readFile(schemaPath, "utf8");
  for (const required of [
    "worktree_status(task_id: String!): WorktreeStatusView!",
    "worktree_create(task_id: String!, operation_id: String!): WorktreeStatusView!",
    "worktree_discard(task_id: String!, operation_id: String!): WorktreeDiscardResult!",
  ]) {
    if (!schema.includes(required)) {
      throw new Error(`Worktree schema is missing ${required}`);
    }
  }
  const operation = async (name) =>
    (
      await readFile(
        join(sourceRoot, `features/agents/worktrees/operations/${name}.graphql`),
        "utf8",
      )
    ).trim();
  const source = await operation("worktreeStatus");
  const createSource = await operation("worktreeCreate");
  const discardSource = await operation("worktreeDiscard");
  const target = join(outputRoot, "worktrees");
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "worktreeStatus.ts"),
    `// Generated from operations/worktreeStatus.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";

/**
 * Discriminated on \`kind\`:
 *   "worktree" — a live checkout; every Git fact below is populated,
 *   "no_repo"  — nothing could enclose this Work Item (\`reason\` set),
 *   "none"     — a repository exists but no checkout does yet.
 */
export interface WorktreeStatusPayload {
  readonly kind: "worktree" | "no_repo" | "none";
  readonly task_id: string;
  readonly top_level_task_id: string;
  readonly is_shared: boolean;
  readonly branch: string | null;
  readonly base_branch: string | null;
  readonly path: string | null;
  readonly state: string | null;
  readonly clean: boolean | null;
  readonly dirty: boolean | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly conflict: boolean | null;
  readonly checkout_present: boolean | null;
  readonly ephemeral: boolean;
  readonly reason: string | null;
}

export interface WorktreeStatusVariables {
  readonly taskId: string;
}
export interface WorktreeStatusQuery {
  readonly worktree_status: WorktreeStatusPayload;
}

const source = ${JSON.stringify(source)};
export const WorktreeStatusDocument: TypedDocumentNode<
  WorktreeStatusQuery, WorktreeStatusVariables
> = { kind: "Document", operationName: "WorktreeStatus", source };
`,
    "utf8",
  );
  await writeFile(
    join(target, "worktreeCreate.ts"),
    `// Generated from operations/worktreeCreate.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";
import type { WorktreeStatusPayload } from "./worktreeStatus";

/**
 * The caller submits two identities and nothing else: the Work Item to
 * isolate, and a stable identity for this intent. Reusing the operation
 * identity — a double-click, a retried transport — returns the same worktree
 * rather than creating a second one.
 *
 * The response is the authoritative status of the checkout that now exists,
 * so the window that asked does not have to refetch to be correct.
 */
export interface WorktreeCreateVariables {
  readonly taskId: string;
  readonly operationId: string;
}
export interface WorktreeCreateMutation {
  readonly worktree_create: WorktreeStatusPayload;
}

const source = ${JSON.stringify(createSource)};
export const WorktreeCreateDocument: TypedDocumentNode<
  WorktreeCreateMutation, WorktreeCreateVariables
> = { kind: "Document", operationName: "WorktreeCreate", source };
`,
    "utf8",
  );
  await writeFile(
    join(target, "worktreeDiscard.ts"),
    `// Generated from operations/worktreeDiscard.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";
import type { WorktreeStatusPayload } from "./worktreeStatus";

/**
 * The caller submits two identities and nothing else: the Work Item whose
 * checkout is being thrown away, and a stable identity for this intent. There
 * is no path, branch, repository, or force argument to give, so nothing a
 * client sends can widen what a discard removes.
 *
 * Reusing the operation identity — a double-click, a retried transport —
 * replays the durable result rather than discarding again.
 */
export interface WorktreeDiscardVariables {
  readonly taskId: string;
  readonly operationId: string;
}

/**
 * \`removed: false\` is an ordinary answer: the Work Item had no checkout to
 * throw away. \`status\` is the authoritative worktree status afterwards, so
 * the window that confirmed does not have to refetch to be correct.
 */
export interface WorktreeDiscardPayload {
  readonly removed: boolean;
  readonly task_id: string;
  readonly top_level_task_id: string;
  readonly branch: string | null;
  readonly reason: string | null;
  readonly status: WorktreeStatusPayload;
}
export interface WorktreeDiscardMutation {
  readonly worktree_discard: WorktreeDiscardPayload;
}

const source = ${JSON.stringify(discardSource)};
export const WorktreeDiscardDocument: TypedDocumentNode<
  WorktreeDiscardMutation, WorktreeDiscardVariables
> = { kind: "Document", operationName: "WorktreeDiscard", source };
`,
    "utf8",
  );
}
