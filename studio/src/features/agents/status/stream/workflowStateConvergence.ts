/**
 * Workflow-state convergence from durable facts.
 *
 * Facts carry the displayed fields, while generated catalog rows also retain
 * protected fields and timestamps. Merge facts into complete cached rows;
 * a previously unseen state must come from a canonical catalog read.
 */
import type { State } from "../../../workflows";
import { publicWorktrackerId } from "../../../../shared/api/generatedWorktracker";
import {
  getStatesSnapshot,
  removeState,
  setStatesSorted,
  upsertState,
} from "../../../../features/projects";
import { advanceStateCatalogRevision, stateCatalogRevision, stateCatalogChangedSince } from "../../../../shared/stateCatalogRevision";
import { useWorkflowEditorStore, readWorkflowCatalog } from "../../../workflows";
import type { WorkflowStateRow } from "./statusFacts";

function syncEditor(projectId: string, states: State[]): void {
  const editor = useWorkflowEditorStore.getState();
  if (editor.projectId !== projectId) return;
  useWorkflowEditorStore.setState({ states });
}

const hydrating = new Set<string>();

/**
 * Reads the canonical catalog until a response spans no newer state fact. A
 * newer fact may rename or delete states while the read is in flight, so that
 * response is stale; no-cache keeps it out of Apollo and a fresh read replaces
 * it, which still carries every unseen state that is waiting to hydrate.
 */
function hydrateCatalog(projectId: string): void {
  // An in-flight read sees the advanced revision and re-reads for this fact.
  if (hydrating.has(projectId)) return;
  hydrating.add(projectId);
  const revision = stateCatalogRevision(projectId);
  void readWorkflowCatalog(projectId, "no-cache").then(({ states }) => {
    hydrating.delete(projectId);
    if (stateCatalogChangedSince(projectId, revision)) {
      hydrateCatalog(projectId);
      return;
    }
    setStatesSorted(projectId, states);
    syncEditor(projectId, getStatesSnapshot(projectId));
  }, () => {
    hydrating.delete(projectId);
  });
}

export function applyWorkflowStateFact(
  projectId: string,
  stateId: string,
  removed: boolean,
  row: WorkflowStateRow | null,
): void {
  // Facts carry the stored hyphen-less identity while the cached catalog keys
  // states by their public form, so normalise before matching a cached row.
  if (removed) {
    removeState(projectId, publicWorktrackerId(stateId));
    advanceStateCatalogRevision(projectId);
    syncEditor(projectId, getStatesSnapshot(projectId));
    return;
  }
  if (!row) return;
  const id = publicWorktrackerId(row.id);
  const existing = getStatesSnapshot(projectId).find((state) => state.id === id);
  if (!existing) {
    // This fact does not select the full generated row. Preserve its revision
    // marker, then acquire the missing catalog fields from their server owner.
    advanceStateCatalogRevision(projectId, { ...row, id });
    hydrateCatalog(projectId);
    return;
  }
  const authoritative: State = { ...existing, ...row, id };
  advanceStateCatalogRevision(projectId, authoritative);
  syncEditor(projectId, upsertState(projectId, authoritative));
}
