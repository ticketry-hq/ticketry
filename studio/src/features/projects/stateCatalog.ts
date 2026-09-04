import { skipToken, useFragment, useQuery } from "@apollo/client/react";
import type { State } from "../../shared/api/types";
import {
  compactWorktrackerId,
  publicWorktrackerId,
} from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import { readProjectOpen } from "./queries/readTransport";
import {
  GeneratedWorkTrackerStateFieldsFragmentDoc,
  WorkTrackerProjectStatesDocument,
} from "./generated/projects.documents";
import type {
  GeneratedWorkTrackerStateFieldsFragment,
  WorkTrackerProjectStatesQuery,
} from "./generated/projects.documents";

const EMPTY_STATES: State[] = [];

const cacheId = (value: string): string =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? compactWorktrackerId(value)
    : value;

const bySortOrder = (rows: State[]): State[] =>
  [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

const stateFromRow = (row: GeneratedWorkTrackerStateFieldsFragment): State => ({
  id: publicWorktrackerId(row.id),
  name: row.name,
  group: row.group,
  color: row.color,
  sort_order: row.sort_order,
  is_protected: row.is_protected,
});

const rowsFromStates = (projectId: string, states: State[]) => states.map(
  (state, index) => ({
    __typename: "WorktrackerState" as const,
    id: cacheId(state.id!),
    project: cacheId(projectId),
    name: state.name,
    group: state.group,
    color: state.color ?? "",
    sort_order: state.sort_order ?? index,
    is_protected: state.is_protected ?? false,
    created_at: new Date(index).toISOString(),
    updated_at: new Date(index).toISOString(),
  }),
);

function statesFromData(data: { states: { nodes: GeneratedWorkTrackerStateFieldsFragment[] } }): State[] {
  return bySortOrder(data.states.nodes.map(stateFromRow));
}

export function getStatesSnapshot(projectId: string | null): State[] {
  if (!projectId) return [];
  const data = studioApolloClient().readQuery({
    query: WorkTrackerProjectStatesDocument,
    variables: { projectId: compactWorktrackerId(projectId) },
    optimistic: true,
  });
  return data ? statesFromData(data) : [];
}

export function stateById(
  states: readonly State[],
  stateId: string | null | undefined,
): State | null {
  return states.find((state) => state.id === stateId) ?? null;
}

export async function loadStates(projectId: string): Promise<State[]> {
  const opened = await readProjectOpen(projectId, "cache-first");
  return statesFromData(opened.data);
}

export async function reloadStates(projectId: string): Promise<State[]> {
  const opened = await readProjectOpen(projectId, "network-only");
  return statesFromData(opened.data);
}

export function useCachedStates(projectId: string | null): State[] {
  const query = useQuery(
    WorkTrackerProjectStatesDocument,
    projectId
      ? {
          variables: { projectId: compactWorktrackerId(projectId) },
          client: studioApolloClient(),
          fetchPolicy: "cache-only",
        }
      : skipToken,
  );
  return query.data ? statesFromData(query.data) : EMPTY_STATES;
}

/** Subscribe to one normalized workflow-state row without depending on a list query. */
export function useCachedState(stateId: string | null): State | null {
  const fragment = useFragment({
    client: studioApolloClient(),
    fragment: GeneratedWorkTrackerStateFieldsFragmentDoc,
    from: stateId
      ? { __typename: "WorktrackerState", id: cacheId(stateId) }
      : null,
  });
  return stateId && fragment.complete
    ? stateFromRow(fragment.data as GeneratedWorkTrackerStateFieldsFragment)
    : null;
}

export function setStates(projectId: string, states: State[]): void {
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectStatesDocument,
    variables: { projectId: compactWorktrackerId(projectId) },
    data: {
      states: {
        __typename: "WorktrackerStateConnection",
        nodes: rowsFromStates(projectId, states),
      },
    } as unknown as WorkTrackerProjectStatesQuery,
  });
}

export function setStatesSorted(projectId: string, states: State[]): void {
  setStates(projectId, bySortOrder(states));
}

export function upsertState(projectId: string, authoritative: State): State[] {
  const next = bySortOrder([
    ...getStatesSnapshot(projectId).filter(
      (state) => state.id !== authoritative.id,
    ),
    authoritative,
  ]);
  setStates(projectId, next);
  return next;
}

export function removeState(projectId: string, stateId: string): void {
  setStates(
    projectId,
    getStatesSnapshot(projectId).filter((state) => state.id !== stateId),
  );
  studioApolloClient().cache.evict({
    id: studioApolloClient().cache.identify({
      __typename: "WorktrackerState",
      id: compactWorktrackerId(stateId),
    }),
  });
  studioApolloClient().cache.gc();
}

export function seedStates(projectId: string, states: State[]): void {
  setStatesSorted(projectId, states);
}
