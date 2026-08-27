import { skipToken, useQuery } from "@apollo/client/react";
import type { IssueType, SubtreeRunCapabilityMap } from "../../shared/api/types";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import {
  readProjectOpen,
  WorkTrackerProjectIssueTypesDocument,
} from "../projects";
import {
  issueType,
  getWorkflowCatalogSnapshot,
  readWorkflowCatalog,
} from "../workflows/queries/projectCatalog";

const seededCapabilities = new Map<string, SubtreeRunCapabilityMap>();

const bySortOrder = <T extends { sort_order?: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

async function fetchIssueTypes(projectId: string): Promise<IssueType[]> {
  return bySortOrder((await readWorkflowCatalog(projectId)).issueTypes.map(issueType));
}

export async function loadIssueTypes(
  projectId: string,
  loader: (projectId: string) => Promise<IssueType[]> = fetchIssueTypes,
): Promise<IssueType[]> {
  const rows = await loader(projectId);
  if (loader !== fetchIssueTypes) setIssueTypesSorted(projectId, rows);
  return rows;
}

export function getIssueTypesSnapshot(projectId: string | null): IssueType[] {
  if (!projectId) return [];
  return getWorkflowCatalogSnapshot(projectId)?.issueTypes.map(issueType) ?? [];
}

export function issueTypeById(
  issueTypes: readonly IssueType[],
  issueTypeId: string | null | undefined,
): IssueType | null {
  return issueTypes.find((candidate) => candidate.id === issueTypeId) ?? null;
}

function capabilitiesFromProject(projectId: string): SubtreeRunCapabilityMap {
  const seeded = seededCapabilities.get(projectId);
  if (seeded) return seeded;
  const catalog = getWorkflowCatalogSnapshot(projectId);
  if (!catalog) return {};
  const capabilities: SubtreeRunCapabilityMap = {};
  for (const binding of catalog.launchBindings) {
    if (!binding.subtree_run_enabled) continue;
    capabilities[binding.issue_type] = [
      ...(capabilities[binding.issue_type] ?? []),
      binding.state,
    ];
  }
  return capabilities;
}

export function getCapabilitiesSnapshot(
  projectId: string | null,
): SubtreeRunCapabilityMap {
  return projectId ? capabilitiesFromProject(projectId) : {};
}

export function setIssueTypes(projectId: string, issueTypes: IssueType[]): void {
  const variables = { projectId: compactWorktrackerId(projectId) };
  const current = studioApolloClient().readQuery({
    query: WorkTrackerProjectIssueTypesDocument,
    variables,
    optimistic: true,
  });
  const currentById = new Map(
    current?.issue_types.nodes.map((row) => [row.id, row]) ?? [],
  );
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectIssueTypesDocument,
    variables,
    data: {
      issue_types: {
        __typename: "WorktrackerIssuetypeConnection",
        nodes: issueTypes.map((type, index) => {
          const id = compactWorktrackerId(type.id);
          const existing = currentById.get(id);
          return {
            __typename: "WorktrackerIssuetype",
            id,
            project: compactWorktrackerId(type.project ?? projectId),
            name: type.name,
            level: type.level,
            color: type.color ?? "",
            sort_order: type.sort_order ?? index,
            start_state: type.start_state
              ? compactWorktrackerId(type.start_state)
              : null,
            workflow_revision: type.workflow_revision ?? 0,
            is_pathfind: existing?.is_pathfind ?? false,
            created_at: existing?.created_at ?? new Date(index).toISOString(),
            updated_at: existing?.updated_at ?? new Date(index).toISOString(),
            transitions: existing?.transitions ?? {
              __typename: "WorktrackerIssuetypetransitionConnection",
              nodes: [],
            },
            launch_bindings: existing?.launch_bindings ?? {
              __typename: "WorktrackerLaunchbindingConnection",
              nodes: [],
            },
          };
        }),
      },
    } as never,
  });
}

export function setIssueTypesSorted(
  projectId: string,
  issueTypes: IssueType[],
): void {
  setIssueTypes(projectId, bySortOrder(issueTypes));
}

export function setCapabilities(
  projectId: string,
  map: SubtreeRunCapabilityMap,
): void {
  seededCapabilities.set(projectId, map);
}

export async function loadSettings(projectId: string): Promise<void> {
  await readProjectOpen(projectId, "network-only");
  seededCapabilities.delete(projectId);
}

export async function ensureSettings(projectId: string): Promise<void> {
  await readProjectOpen(projectId, "cache-first");
}

export async function refreshSubtreeRunCapabilities(
  projectId: string,
): Promise<void> {
  try {
    await readProjectOpen(projectId, "network-only");
    seededCapabilities.delete(projectId);
  } catch {
    // The workflow write already committed; the next project load retries.
  }
}

export function synchronizeSubtreeRunCapabilities(
  projectId: string,
  issueTypeId: string,
  enabledStateIds: string[],
): void {
  const next = { ...getCapabilitiesSnapshot(projectId) };
  if (enabledStateIds.length > 0) next[issueTypeId] = enabledStateIds;
  else delete next[issueTypeId];
  seededCapabilities.set(projectId, next);
}

export function useSubtreeRunCapabilitiesQuery(projectId: string | null) {
  const query = useQuery(
    WorkTrackerProjectIssueTypesDocument,
    projectId
      ? {
          variables: { projectId: compactWorktrackerId(projectId) },
          client: studioApolloClient(),
          fetchPolicy: "cache-first",
        }
      : skipToken,
  );
  return {
    ...query,
    data: projectId && query.data ? capabilitiesFromProject(projectId) : undefined,
  };
}

export function useIssueTypesQuery(projectId: string | null) {
  const query = useQuery(
    WorkTrackerProjectIssueTypesDocument,
    projectId
      ? {
          variables: { projectId: compactWorktrackerId(projectId) },
          client: studioApolloClient(),
          fetchPolicy: "cache-first",
        }
      : skipToken,
  );
  return {
    ...query,
    data: query.data
      ? bySortOrder(query.data.issue_types.nodes.map(issueType))
      : undefined,
  };
}

export function seedIssueTypes(projectId: string, issueTypes: IssueType[]): void {
  setIssueTypes(projectId, issueTypes);
}

export function seedCapabilities(
  projectId: string,
  map: SubtreeRunCapabilityMap,
): void {
  setCapabilities(projectId, map);
}
