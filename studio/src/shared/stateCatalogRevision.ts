import type { WorktrackerState } from "../graphql-foundation/generated/schemaTypes";

const revisions = new Map<string, number>();
const authoritativeStates = new Map<string, Map<string, CatalogState>>();

/**
 * Partial reconciliation view of a generated state: legacy drafts may have no
 * identity/color, while event snapshots may omit protection and ordering.
 */
type CatalogState = Pick<WorktrackerState, "name" | "group"> & {
  id: WorktrackerState["id"] | null;
  color: WorktrackerState["color"] | null;
  sort_order?: WorktrackerState["sortOrder"];
  is_protected?: WorktrackerState["isProtected"];
};

export function stateCatalogRevision(projectId: string): number {
  return revisions.get(projectId) ?? 0;
}

export function advanceStateCatalogRevision(
  projectId: string,
  states?: CatalogState | CatalogState[],
): void {
  revisions.set(projectId, stateCatalogRevision(projectId) + 1);
  if (!states) return;
  const projectStates = authoritativeStates.get(projectId) ?? new Map();
  for (const state of Array.isArray(states) ? states : [states]) {
    if (!state.id) continue;
    projectStates.set(state.id, state);
  }
  authoritativeStates.set(projectId, projectStates);
}

export function stateCatalogChangedSince(
  projectId: string,
  revision: number,
): boolean {
  return stateCatalogRevision(projectId) !== revision;
}

export function overlayAuthoritativeState<T extends CatalogState | null>(
  projectId: string,
  state: T,
): T {
  if (!state?.id) return state;
  const authoritative = authoritativeStates.get(projectId)?.get(state.id);
  return authoritative ? { ...state, ...authoritative } as T : state;
}
