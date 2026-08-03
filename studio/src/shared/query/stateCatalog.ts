import { useQuery } from "@tanstack/react-query";
import * as api from "../api/client";
import { queryClient } from "./queryClient";
import { queryKeys } from "./keys";
import type { State } from "../api/types";

// The project workflow-state catalog, cached once per project. Settings, the
// backlog, and the workflow editor's sync path all read and write THIS entry —
// there is deliberately no second copy to keep agreed. Entries are stored in
// canonical sort order so every consumer inherits it.

const EMPTY_STATES: State[] = [];

const bySortOrder = (rows: State[]): State[] =>
  [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

async function fetchStates(projectId: string): Promise<State[]> {
  return bySortOrder(await api.listStates(projectId));
}

/** Cached states for a project, [] before the first load resolves. */
export function getStatesSnapshot(projectId: string | null): State[] {
  if (!projectId) return [];
  return (
    queryClient.getQueryData<State[]>(queryKeys.states.byProject(projectId)) ?? []
  );
}

/** Fetch (deduped) and cache a project's states. */
export function loadStates(projectId: string): Promise<State[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.states.byProject(projectId),
    queryFn: () => fetchStates(projectId),
  });
}

/** Force a refetch, bypassing staleTime. */
export function reloadStates(projectId: string): Promise<State[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.states.byProject(projectId),
    queryFn: () => fetchStates(projectId),
    staleTime: 0,
  });
}

/**
 * Subscribe to the cached catalog WITHOUT triggering a fetch. For surfaces that
 * read along with whoever owns the load (the backlog, planning views): they
 * must re-render when the catalog changes, but must not issue their own request.
 */
export function useCachedStates(projectId: string | null): State[] {
  const { data } = useQuery(
    {
      queryKey: queryKeys.states.byProject(projectId ?? "none"),
      queryFn: () => fetchStates(projectId!),
      enabled: false,
    },
    queryClient,
  );
  return data ?? EMPTY_STATES;
}

/**
 * Write the catalog directly, preserving the caller's order. The workflow
 * editor's rename/reorder/delete flows use this so one authoritative server
 * response lands in the single cached catalog instead of being fanned out to
 * per-store copies. Order is the caller's business here: an optimistic reorder
 * must survive until the server answers, so this deliberately does not sort.
 */
export function setStates(projectId: string, states: State[]): void {
  void queryClient.cancelQueries({
    queryKey: queryKeys.states.byProject(projectId),
    exact: true,
  });
  queryClient.setQueryData(queryKeys.states.byProject(projectId), states);
}

/** Write the catalog in canonical sort order (for server responses). */
export function setStatesSorted(projectId: string, states: State[]): void {
  void queryClient.cancelQueries({
    queryKey: queryKeys.states.byProject(projectId),
    exact: true,
  });
  queryClient.setQueryData(
    queryKeys.states.byProject(projectId),
    bySortOrder(states),
  );
}

/** Insert-or-replace one state, keeping canonical order. */
export function upsertState(projectId: string, authoritative: State): State[] {
  const next = bySortOrder([
    ...getStatesSnapshot(projectId).filter(
      (state) => state.id !== authoritative.id,
    ),
    authoritative,
  ]);
  queryClient.setQueryData(queryKeys.states.byProject(projectId), next);
  return next;
}

export function removeState(projectId: string, stateId: string): void {
  queryClient.setQueryData<State[]>(
    queryKeys.states.byProject(projectId),
    (old) => old?.filter((state) => state.id !== stateId),
  );
}

/** Test seam. */
export function seedStates(projectId: string, states: State[]): void {
  queryClient.setQueryData(
    queryKeys.states.byProject(projectId),
    bySortOrder(states),
  );
}
