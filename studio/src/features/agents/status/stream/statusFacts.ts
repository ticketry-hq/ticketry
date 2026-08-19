/**
 * Readers for the durable status event families.
 *
 * The outbox stores domain facts, not cache instructions, so every family is
 * narrowed here once and the rest of the consumer works with typed values. An
 * unknown family, a malformed payload, or a payload this build cannot read is
 * `null` — it is skipped rather than guessed at, and the caller leaves its
 * holding untouched.
 */
import type { RunStatusEventFrame } from "../generated/statusStream";
import type { AutomationAttemptPayload } from "../generated/attempts";
import { toAutomationAttemptRecord } from "./statusHoldingAdapters";
import type { AutomationAttemptRecord, RawLifecycleState } from "../types";

export const AGENT_RUN_LIFECYCLE = "agent_run.lifecycle";
export const AGENT_RUN_TERMINAL = "agent_run.terminal";
export const WORK_ITEM_CHANGED = "work_item.changed";
export const WORK_ITEM_DELETED = "work_item.deleted";
export const WORKFLOW_STATE_CHANGED = "workflow_state.changed";
export const WORKFLOW_STATE_DELETED = "workflow_state.deleted";
export const DOCUMENT_CHANGED = "document.changed";
export const DOCUMENT_DELETED = "document.deleted";
export const WORKTREE_CHANGED = "worktree.changed";
export const WORKTREE_DELETED = "worktree.deleted";

const ATTEMPT_KINDS: ReadonlySet<string> = new Set([
  "automation_attempt_created",
  "automation_attempt_outcome",
  "automation_attempt_dismissed",
  "automation_attempt_retried",
]);

export interface AgentRunFact {
  readonly family: "agent_run";
  readonly agentRunId: string;
  readonly state: RawLifecycleState;
  readonly occurredAt: string;
}

export interface WorkItemFact {
  readonly family: "work_item";
  readonly workItemId: string;
  readonly removed: boolean;
  readonly membershipChanged: boolean;
}

export interface WorkflowStateFact {
  readonly family: "workflow_state";
  readonly stateId: string;
  readonly removed: boolean;
  readonly state: WorkflowStateRow | null;
}

export interface WorkflowStateRow {
  readonly id: string;
  readonly name: string;
  readonly group: string;
  readonly color: string;
  readonly sort_order: number;
}

export interface AutomationAttemptFact {
  readonly family: "automation_attempt";
  readonly attempt: AutomationAttemptRecord;
}

/**
 * One design document appeared, changed, or went away.
 *
 * The fact names the registry it belongs to rather than the query to refetch:
 * `scope` and `ownerId` are exactly the two values the registry cache is keyed
 * by, so a consumer can converge one Work Item's documents or one module's
 * scratch workspace and leave every other registry alone.
 */
export interface DocumentFact {
  readonly family: "document";
  readonly scope: "task" | "scratch";
  readonly ownerId: string;
  readonly moduleId: string | null;
  readonly removed: boolean;
}

/**
 * One Work Item's Git worktree was created, hit a conflict, was discarded, was
 * integrated, or was finished by a restart.
 *
 * The fact names the *owner* rather than the Work Item whose window asked for
 * the change: one top-level Work Item owns the checkout and its descendants
 * share it, so the owner is the one holding a consumer converges. `projectId`
 * is the project the durable outbox partitioned the fact into, which is what
 * makes a late fact from a project that is no longer selected identifiable.
 */
export interface WorktreeFact {
  readonly family: "worktree";
  readonly topLevelTaskId: string;
  readonly projectId: string;
  readonly removed: boolean;
}

export type StatusFact =
  | AgentRunFact
  | WorkItemFact
  | WorkflowStateFact
  | AutomationAttemptFact
  | DocumentFact
  | WorktreeFact;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function readWorkflowStateRow(value: unknown): WorkflowStateRow | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const name = value.name;
  const group = value.group;
  const color = value.color;
  const sortOrder = value.sort_order;
  if (
    id === null ||
    typeof name !== "string" ||
    typeof group !== "string" ||
    typeof color !== "string" ||
    typeof sortOrder !== "number"
  ) {
    return null;
  }
  return { id, name, group, color, sort_order: sortOrder };
}

function readAttempt(value: unknown): AutomationAttemptRecord | null {
  if (!isRecord(value)) return null;
  if (
    text(value.attempt_id) === null ||
    text(value.root_attempt_id) === null ||
    text(value.work_item_id) === null ||
    typeof value.status !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }
  return toAutomationAttemptRecord(value as unknown as AutomationAttemptPayload);
}

/** Narrow one durable event into the fact its family describes. */
export function readStatusFact(frame: RunStatusEventFrame): StatusFact | null {
  const payload = frame.payload as Record<string, unknown>;
  switch (frame.event_kind) {
    case AGENT_RUN_LIFECYCLE:
    case AGENT_RUN_TERMINAL: {
      const agentRunId = text(payload.agentRunId) ?? text(frame.agent_run_id);
      const state = text(payload.state);
      const occurredAt = text(payload.occurredAt) ?? frame.committed_at;
      if (agentRunId === null || state === null) return null;
      return {
        family: "agent_run",
        agentRunId,
        state: state as RawLifecycleState,
        occurredAt,
      };
    }
    case WORK_ITEM_CHANGED:
    case WORK_ITEM_DELETED: {
      const workItemId = text(payload.workItemId) ?? text(frame.work_item_id);
      if (workItemId === null) return null;
      return {
        family: "work_item",
        workItemId,
        removed: frame.event_kind === WORK_ITEM_DELETED,
        // A fact that does not claim a membership change never forces a
        // containing-collection refetch.
        membershipChanged:
          payload.membershipChanged === true ||
          frame.event_kind === WORK_ITEM_DELETED,
      };
    }
    case WORKFLOW_STATE_CHANGED:
    case WORKFLOW_STATE_DELETED: {
      const stateId = text(payload.stateId) ?? text(frame.subject_id);
      if (stateId === null) return null;
      const removed = frame.event_kind === WORKFLOW_STATE_DELETED;
      const state = removed ? null : readWorkflowStateRow(payload.state);
      // A change with no readable row cannot converge a rename or recolour, so
      // it is skipped rather than applied as a partial state.
      if (!removed && state === null) return null;
      return { family: "workflow_state", stateId, removed, state };
    }
    case DOCUMENT_CHANGED:
    case DOCUMENT_DELETED: {
      const ownerId = text(payload.ownerId);
      const scope = payload.scope;
      // Without the bucket there is nothing to converge, and refreshing every
      // registry because one document moved would undo the point of publishing
      // the bucket at all.
      if (ownerId === null || (scope !== "task" && scope !== "scratch")) {
        return null;
      }
      return {
        family: "document",
        scope,
        ownerId,
        moduleId: text(payload.moduleId),
        removed: frame.event_kind === DOCUMENT_DELETED,
      };
    }
    case WORKTREE_CHANGED:
    case WORKTREE_DELETED: {
      // The owner is the whole address. A fact that cannot name it describes
      // no holding this consumer can converge, so it is skipped rather than
      // widened into a refresh of every worktree on screen.
      const topLevelTaskId = text(payload.topLevelTaskId);
      if (topLevelTaskId === null) return null;
      return {
        family: "worktree",
        topLevelTaskId,
        projectId: frame.project_id,
        removed: frame.event_kind === WORKTREE_DELETED,
      };
    }
    default: {
      if (!ATTEMPT_KINDS.has(frame.event_kind)) return null;
      const attempt = readAttempt(payload);
      return attempt ? { family: "automation_attempt", attempt } : null;
    }
  }
}
