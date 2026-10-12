import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import type { State, StateCreate, StatePatch } from "../../../shared/api/types";
import { declareMutation, refreshRead } from "../../../shared/apollo/declaredMutation";
import { WorkTrackerProjectOpenDocument } from "../../projects";
import { WorkTrackerWorkItemsDocument } from "../../work-items";
import {
  CreateWorkTrackerStateDocument,
  DeleteWorkTrackerStateDocument,
  ReorderWorkTrackerStatesDocument,
  UpdateWorkTrackerStateDocument,
} from "../generated/workflows.documents";

/** The workflow catalog: every state, issue type and per-type workflow setting. */
export const workflowCatalog = (projectId: string) =>
  refreshRead(WorkTrackerProjectOpenDocument, { projectId: compactWorktrackerId(projectId) });

export interface StateCreation {
  projectId: string;
  body: StateCreate;
}

/** Create a state: the project's workflow catalog gains it. */
export const stateCreationMutation = declareMutation({
  document: CreateWorkTrackerStateDocument,
  variables: ({ projectId, body }: StateCreation) => ({
    projectId,
    name: body.name,
    group: body.group,
    color: body.color,
  }),
  root: "create_state",
  refresh: ({ projectId }) => [workflowCatalog(projectId)],
  result: (row): State => ({ ...row }),
});

export interface StateUpdate {
  id: string;
  patch: StatePatch;
}

/** Rename, regroup, recolor or reposition a state in its project's catalog. */
export const stateUpdateMutation = declareMutation({
  document: UpdateWorkTrackerStateDocument,
  variables: ({ id, patch }: StateUpdate) => ({
    id,
    name: patch.name,
    group: patch.group,
    color: patch.color,
    sortOrder: patch.sort_order,
  }),
  root: "update_state",
  refresh: (_update, row) => [workflowCatalog(row.project)],
  result: (row): State => ({ ...row }),
});

export interface StateDeletion {
  projectId: string;
  id: string;
}

/**
 * Delete a state. Its identity leaves the cache, and the editor's deletion
 * reads (the catalog's states and every type's workflow settings, plus the
 * project's items behind the per-state counts) are re-read.
 */
export const stateDeletionMutation = declareMutation({
  document: DeleteWorkTrackerStateDocument,
  variables: ({ id }: StateDeletion) => ({ id }),
  root: "delete_state",
  evict: ({ id }) => [{ __typename: "WorktrackerState", id: compactWorktrackerId(id) }],
  refresh: ({ projectId }) => [
    workflowCatalog(projectId),
    refreshRead(WorkTrackerWorkItemsDocument, { projectId: compactWorktrackerId(projectId) }),
  ],
  result: () => undefined,
});

export interface StateReorder {
  projectId: string;
  orderedIds: string[];
}

/** Reorder a project's states, the quarantined domain operation; ranks settle to the server's. */
export const stateReorderMutation = declareMutation({
  document: ReorderWorkTrackerStatesDocument,
  variables: ({ projectId, orderedIds }: StateReorder) => ({ projectId, orderedIds }),
  root: "reorder_states",
  refresh: ({ projectId }) => [workflowCatalog(projectId)],
  result: (rows): State[] => rows.map((row) => ({ ...row })),
});
