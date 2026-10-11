import { createApolloStore } from "../../shared/apollo/localState";

type Readiness = { revision: number; pending: number; needsRead: boolean };
const initial: Readiness = { revision: 0, pending: 0, needsRead: false };
const useReadiness = createApolloStore<{ scopes: Record<string, Readiness> }>("suggestion-readiness", () => ({ scopes: {} }));
const keyOf = (projectId: string, sprintId: string) => `${projectId}:${sprintId}`;
const stateOf = (key: string) => useReadiness.getState().scopes[key] ?? initial;
const patch = (key: string, value: Readiness) => useReadiness.setState((state) => ({ scopes: { ...state.scopes, [key]: value } }));

/** Command readiness only; server records and remembered visit intent remain in their Apollo rows. */
export function useSuggestionReadiness(projectId: string, sprintId: string) {
  const state = useReadiness((row) => row.scopes[keyOf(projectId, sprintId)] ?? initial);
  return { needsRead: state.needsRead, pending: state.pending > 0, ready: state.pending === 0 && !state.needsRead };
}
export function readSuggestionReadiness(projectId: string, sprintId: string) {
  const state = stateOf(keyOf(projectId, sprintId));
  return { needsRead: state.needsRead, pending: state.pending > 0, ready: state.pending === 0 && !state.needsRead };
}
export function suggestionReadScope(projectId: string, sprintId: string) {
  const key = keyOf(projectId, sprintId);
  return {
    begin: () => { const state = stateOf(key); const revision = state.revision + 1; patch(key, { revision, pending: state.pending + 1, needsRead: true }); return revision; },
    finish: (revision: number, readRequired: boolean) => { const state = stateOf(key); patch(key, { ...state, pending: Math.max(0, state.pending - 1), needsRead: state.revision === revision ? readRequired : state.needsRead }); },
    revision: () => stateOf(key).revision,
    pending: () => stateOf(key).pending > 0,
    refreshed: (revision: number) => { const state = stateOf(key); if (state.revision === revision) patch(key, { ...state, needsRead: false }); },
  };
}
