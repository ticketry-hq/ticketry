import { skipToken, useQuery } from "@apollo/client/react";
import { useMemo } from "react";
import type { State } from "../workflows";
import {
  compactWorktrackerId,
} from "../../shared/api/generatedWorktracker";
import { publicResult, serverVariables } from "../../shared/api/worktrackerConversion";
import { studioApolloClient } from "../../shared/apollo/client";
import { readProjectOpen } from "./queries/readTransport";
import { WorkTrackerProjectStatesDocument } from "./generated/projects.documents";
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
  [...rows].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));

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
    created_at: state.created_at,
    updated_at: state.updated_at,
  }),
);

function statesFromData(data: { states: { nodes: GeneratedWorkTrackerStateFieldsFragment[] } }): State[] {
  return bySortOrder(publicResult(WorkTrackerProjectStatesDocument, data).states.nodes);
}

export function getStatesSnapshot(projectId: string | null): State[] {
  if (!projectId) return [];
  const data = studioApolloClient().readQuery({
    query: WorkTrackerProjectStatesDocument,
    variables: serverVariables(WorkTrackerProjectStatesDocument, { projectId }),
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
          variables: serverVariables(WorkTrackerProjectStatesDocument, { projectId }),
          client: studioApolloClient(),
          fetchPolicy: "cache-only",
        }
      : skipToken,
  );
  return useMemo(
    () => query.data ? statesFromData(query.data) : EMPTY_STATES,
    [query.data],
  );
}

export function setStates(projectId: string, states: State[]): void {
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectStatesDocument,
    variables: serverVariables(WorkTrackerProjectStatesDocument, { projectId }),
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
