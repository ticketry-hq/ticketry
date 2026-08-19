/**
 * Workflow-state convergence from durable facts.
 *
 * The published fact carries the whole row a surface displays, so a rename,
 * recolour, regroup, or reorder lands in the one cached catalog without a
 * second read. The open workflow editor reads the same catalog, so it is kept
 * in step here rather than owning a second copy.
 */
import type { State } from "../../../../shared/api/types";
import {
  getStatesSnapshot,
  removeState,
  upsertState,
} from "../../../../shared/query/stateCatalog";
import { advanceStateCatalogRevision } from "../../../../shared/stateCatalogRevision";
import { useWorkflowEditorStore } from "../../../workflows";
import type { WorkflowStateRow } from "./statusFacts";

function syncEditor(projectId: string, states: State[]): void {
  const editor = useWorkflowEditorStore.getState();
  if (editor.projectId !== projectId) return;
  useWorkflowEditorStore.setState({ states });
}

export function applyWorkflowStateFact(
  projectId: string,
  stateId: string,
  removed: boolean,
  row: WorkflowStateRow | null,
): void {
  if (removed) {
    removeState(projectId, stateId);
    advanceStateCatalogRevision(projectId);
    syncEditor(projectId, getStatesSnapshot(projectId));
    return;
  }
  if (!row) return;
  const authoritative = row as unknown as State;
  advanceStateCatalogRevision(projectId, authoritative);
  syncEditor(projectId, upsertState(projectId, authoritative));
}
