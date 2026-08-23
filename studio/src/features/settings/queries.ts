import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import type { IssueType, SubtreeRunCapabilityMap } from "../../shared/api/types";
import {
  readSubtreeRunCapabilities,
  readWorkflowIssueTypes,
  readWorkflowStates,
} from "../workflows";

// Project settings server state: the issue-type catalog and the subtree-run
// capability map. Workflow states are NOT duplicated here — they live in the
// one shared catalog (shared/query/stateCatalog.ts) that every surface reads.

const bySortOrder = <T extends { sort_order?: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

const issueTypesKey = (projectId: string) =>
  queryKeys.issueTypes.byProject(projectId);

const capabilitiesKey = (projectId: string) =>
  ["settings", projectId, "subtree-run"] as const;

async function fetchIssueTypes(projectId: string): Promise<IssueType[]> {
  return bySortOrder(
    await readWorkflowIssueTypes(projectId),
  );
}

export function loadIssueTypes(
  projectId: string,
  loader: (projectId: string) => Promise<IssueType[]> = fetchIssueTypes,
): Promise<IssueType[]> {
  return queryClient.fetchQuery({
    queryKey: issueTypesKey(projectId),
    queryFn: () => loader(projectId),
    staleTime: 0,
  });
}

// Local capability writes (a just-saved workflow binding, an explicit refresh)
// are newer than any load already in flight. One monotonic generation per
// project decides that race — the single guard replacing the per-store copies.
const capabilityGenerations = new Map<string, number>();

function advanceCapabilityGeneration(projectId: string): void {
  capabilityGenerations.set(projectId, (capabilityGenerations.get(projectId) ?? 0) + 1);
}

async function fetchCapabilities(
  projectId: string,
): Promise<SubtreeRunCapabilityMap> {
  const generation = capabilityGenerations.get(projectId) ?? 0;
  const fetched = await readSubtreeRunCapabilities(projectId);
  // A synchronize/refresh landed while this request was in flight; what the
  // server just told us is already stale, so keep the newer local map.
  if ((capabilityGenerations.get(projectId) ?? 0) !== generation) {
    return getCapabilitiesSnapshot(projectId);
  }
  return fetched;
}

export function getIssueTypesSnapshot(projectId: string | null): IssueType[] {
  if (!projectId) return [];
  return queryClient.getQueryData<IssueType[]>(issueTypesKey(projectId)) ?? [];
}

export function issueTypeById(
  issueTypes: readonly IssueType[],
  issueTypeId: string | null | undefined,
): IssueType | null {
  return issueTypes.find((issueType) => issueType.id === issueTypeId) ?? null;
}

export function getCapabilitiesSnapshot(
  projectId: string | null,
): SubtreeRunCapabilityMap {
  if (!projectId) return {};
  return (
    queryClient.getQueryData<SubtreeRunCapabilityMap>(
      capabilitiesKey(projectId),
    ) ?? {}
  );
}

/**
 * Write the issue-type catalog, preserving the caller's order — an optimistic
 * reorder has to survive until the server responds.
 */
export function setIssueTypes(projectId: string, issueTypes: IssueType[]): void {
  queryClient.setQueryData(issueTypesKey(projectId), issueTypes);
}

/** Write the issue-type catalog in canonical sort order (server responses). */
export function setIssueTypesSorted(
  projectId: string,
  issueTypes: IssueType[],
): void {
  queryClient.setQueryData(issueTypesKey(projectId), bySortOrder(issueTypes));
}

export function setCapabilities(
  projectId: string,
  map: SubtreeRunCapabilityMap,
): void {
  queryClient.setQueryData(capabilitiesKey(projectId), map);
}

/**
 * Load every settings resource for a project. Concurrent callers share one
 * request per resource — the cache dedups, so the hand-rolled in-flight
 * tracking this replaced is no longer needed.
 */
export async function loadSettings(projectId: string): Promise<void> {
  await Promise.all([
    queryClient.fetchQuery({
      queryKey: issueTypesKey(projectId),
      queryFn: () => fetchIssueTypes(projectId),
      staleTime: 0,
    }),
    queryClient.fetchQuery({
      queryKey: queryKeys.states.byProject(projectId),
      queryFn: () =>
        readWorkflowStates(projectId).then(bySortOrder),
      staleTime: 0,
    }),
    queryClient.fetchQuery({
      queryKey: capabilitiesKey(projectId),
      queryFn: () => fetchCapabilities(projectId),
      staleTime: 0,
    }),
  ]);
}

/** Load at most once per project; later calls resolve from cache. */
export async function ensureSettings(projectId: string): Promise<void> {
  await Promise.all([
    queryClient.ensureQueryData({
      queryKey: issueTypesKey(projectId),
      queryFn: () => fetchIssueTypes(projectId),
    }),
    queryClient.ensureQueryData({
      queryKey: queryKeys.states.byProject(projectId),
      queryFn: () =>
        readWorkflowStates(projectId).then(bySortOrder),
    }),
    queryClient.ensureQueryData({
      queryKey: capabilitiesKey(projectId),
      queryFn: () => fetchCapabilities(projectId),
    }),
  ]);
}

export async function refreshSubtreeRunCapabilities(
  projectId: string,
): Promise<void> {
  advanceCapabilityGeneration(projectId);
  try {
    setCapabilities(projectId, await fetchCapabilities(projectId));
  } catch {
    // The workflow save already succeeded. Preserve the last known map and let
    // a later settings load retry rather than reporting the save as failed.
  }
}

/** Reflect a just-saved workflow binding without a round-trip. */
export function synchronizeSubtreeRunCapabilities(
  projectId: string,
  issueTypeId: string,
  enabledStateIds: string[],
): void {
  advanceCapabilityGeneration(projectId);
  const next = { ...getCapabilitiesSnapshot(projectId) };
  if (enabledStateIds.length > 0) next[issueTypeId] = enabledStateIds;
  else delete next[issueTypeId];
  setCapabilities(projectId, next);
}

export function useSubtreeRunCapabilitiesQuery(projectId: string | null) {
  return useQuery(
    {
      queryKey: capabilitiesKey(projectId ?? "none"),
      queryFn: () => fetchCapabilities(projectId!),
      enabled: projectId !== null,
    },
    queryClient,
  );
}

export function useIssueTypesQuery(projectId: string | null) {
  return useQuery(
    {
      queryKey: issueTypesKey(projectId ?? "none"),
      queryFn: () => fetchIssueTypes(projectId!),
      enabled: projectId !== null,
    },
    queryClient,
  );
}

/** Test seams. */
export function seedIssueTypes(projectId: string, issueTypes: IssueType[]): void {
  setIssueTypes(projectId, issueTypes);
}

export function seedCapabilities(
  projectId: string,
  map: SubtreeRunCapabilityMap,
): void {
  setCapabilities(projectId, map);
}
