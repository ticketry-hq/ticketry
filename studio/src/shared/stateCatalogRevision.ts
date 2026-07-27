const revisions = new Map<string, number>();
const authoritativeStates = new Map<string, Map<string, CatalogState>>();
let generation = 0;

interface CatalogState {
  id: string | null;
  name: string;
  group: string;
  color: string | null;
  sort_order?: number;
  is_protected?: boolean;
}

export function stateCatalogRevision(projectId: string): number {
  return revisions.get(projectId) ?? 0;
}

export function advanceStateCatalogRevision(
  projectId: string,
  states?: CatalogState | CatalogState[],
): void {
  revisions.set(projectId, stateCatalogRevision(projectId) + 1);
  generation += 1;
  if (!states) return;
  const projectStates = authoritativeStates.get(projectId) ?? new Map();
  for (const state of Array.isArray(states) ? states : [states]) {
    if (!state.id) continue;
    projectStates.set(state.id, state);
  }
  authoritativeStates.set(projectId, projectStates);
}

export function stateCatalogGeneration(): number {
  return generation;
}

export function stateCatalogChangedSinceGeneration(
  previousGeneration: number,
): boolean {
  return generation !== previousGeneration;
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
