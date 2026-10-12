import { skipToken, useQuery } from "@apollo/client/react";
import { useEffect, useState } from "react";
import type { Module, Project, ProjectCreate, ProjectPatch, ProjectCreateResult } from "../types";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { serverVariables } from "../../../shared/api/worktrackerConversion";
import { studioApolloClient } from "../../../shared/apollo/client";
import {
  WorkTrackerProjectOpenDocument,
  WorkTrackerProjectsDocument,
} from "../generated/projects.documents";
import {
  createProject as writeProject,
  deleteProject as removeProject,
  updateProject as writeProjectUpdate,
} from "../mutationTransport";
import {
  modulesFromProjectOpen,
  projectsFromResult,
  readOnboardingProjects,
  readProjects,
  readProjectOpen,
} from "./readTransport";

const EMPTY_PROJECTS: Project[] = [];
const EMPTY_MODULES: Module[] = [];

export function getProjectsSnapshot(): Project[] {
  const data = studioApolloClient().readQuery({ query: WorkTrackerProjectsDocument });
  return data ? projectsFromResult(data) : [];
}

export function getModulesSnapshot(projectId: string | null): Module[] {
  if (!projectId) return [];
  const data = studioApolloClient().readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: serverVariables(WorkTrackerProjectOpenDocument, { projectId }),
    optimistic: true,
  });
  return data ? modulesFromProjectOpen(data) : [];
}

export async function loadProjects(): Promise<Project[]> {
  const projects = await readProjects();
  seedProjects(projects);
  return projects;
}

export async function loadModules(
  projectId: string,
  options: { readonly queryDeduplication?: boolean } = {},
): Promise<Module[]> {
  const opened = await readProjectOpen(projectId, "network-only", options);
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: serverVariables(WorkTrackerProjectOpenDocument, { projectId }),
    data: opened.data,
  });
  const ordered = opened.modules;
  seedModules(projectId, ordered);
  return ordered;
}

export function useCachedProjects(): Project[] {
  const query = useQuery(WorkTrackerProjectsDocument, {
    client: studioApolloClient(),
    fetchPolicy: "cache-only",
  });
  return query.data ? projectsFromResult(query.data) : EMPTY_PROJECTS;
}

export function useCachedModules(projectId: string | null): Module[] {
  const query = useQuery(
    WorkTrackerProjectOpenDocument,
    projectId
      ? {
          variables: serverVariables(WorkTrackerProjectOpenDocument, { projectId }),
          client: studioApolloClient(),
          fetchPolicy: "cache-only",
        }
      : skipToken,
  );
  return projectId && query.data
    ? modulesFromProjectOpen(query.data)
    : EMPTY_MODULES;
}

export function useProjectsQuery() {
  const query = useQuery(WorkTrackerProjectsDocument, { client: studioApolloClient() });
  return {
    ...query,
    data: query.data ? projectsFromResult(query.data) : undefined,
    isPending: query.loading,
  };
}

export function useModulesQuery(projectId: string | null) {
  const [loading, setLoading] = useState(Boolean(projectId));
  const [error, setError] = useState<Error>();
  const query = useQuery(
    WorkTrackerProjectOpenDocument,
    projectId
      ? {
          variables: serverVariables(WorkTrackerProjectOpenDocument, { projectId }),
          client: studioApolloClient(),
          fetchPolicy: "cache-only",
        }
      : skipToken,
  );
  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    if (query.data) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void loadModules(projectId).then(
      () => { if (active) setError(undefined); },
      (cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause : new Error(String(cause)));
      },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, query.data]);
  // `loading` starts true and is only cleared by the effect above, which runs
  // after the first paint. Bootstrap has usually already loaded this project,
  // so the cache can answer on that first render — reporting "pending" anyway
  // would blank the module tabs for a frame the render storm can stretch into
  // a visible delay. The cache answering is the end of pending.
  const pending = loading && !query.data;
  return {
    ...query,
    data: projectId && query.data
      ? modulesFromProjectOpen(query.data)
      : undefined,
    error: error ?? query.error,
    loading: pending,
    isPending: pending,
  };
}

export async function createProjectRecord(body: ProjectCreate): Promise<ProjectCreateResult> {
  const created = await writeProject(body);
  // A refresh failure must not turn a committed creation into a failed write.
  await loadProjects().catch(() => {});
  return created;
}

export async function updateProjectRecord(variables: ProjectPatch): Promise<Project> {
  const updated = await writeProjectUpdate(variables);
  const projects = getProjectsSnapshot();
  const current = projects.find(({ id }) => id === updated.id);
  if (current) {
    const project = { ...current, ...updated };
    seedProjects(projects.map((row) => row.id === project.id ? project : row));
    return project;
  }
  const project = (await loadProjects()).find(({ id }) => id === updated.id);
  if (!project) throw new Error(`Project ${updated.id} was not found after update.`);
  return project;
}

export async function deleteProjectRecord(id: string): Promise<void> {
  await removeProject(id);
  studioApolloClient().cache.evict({
    id: studioApolloClient().cache.identify({
      __typename: "WorktrackerProject",
      id: compactWorktrackerId(id),
    }),
  });
  studioApolloClient().cache.gc();
  seedProjects(getProjectsSnapshot().filter((project) => project.id !== id));
}

export function seedProjects(projects: Project[]): void {
  const data = {
    projects: {
      __typename: "WorktrackerProjectConnection",
      nodes: projects.map((project) => ({
        ...project,
        __typename: "WorktrackerProject",
        id: compactWorktrackerId(project.id),
        name: project.name,
        slug: project.slug,
        description: project.description,
        created_at: project.created_at,
      })),
    },
  };
  studioApolloClient().writeQuery({ query: WorkTrackerProjectsDocument, data });
}

export function seedModules(projectId: string, modules: Module[]): void {
  const variables = serverVariables(WorkTrackerProjectOpenDocument, { projectId });
  const current = studioApolloClient().readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables,
  });
  if (!current) return;
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectOpenDocument,
    variables,
    data: {
      ...current,
      modules: {
        ...current.modules,
        nodes: modules.map(({ key, ...module }, index) => ({
          ...current.modules.nodes.find(({ id }) => id === compactWorktrackerId(module.id)),
          __typename: "WorktrackerIssue" as const,
          id: compactWorktrackerId(module.id),
          name: module.name,
          project_id: compactWorktrackerId(module.project_id),
          sequence_id: module.sequence_id,
          is_archived: module.is_archived,
          issue_type: compactWorktrackerId(module.issue_type),
          rank: String(index),
          project: {
            __typename: "WorktrackerProject" as const,
            id: compactWorktrackerId(projectId),
            slug: current.project.nodes[0]?.slug ?? key.split("-")[0] ?? "",
          },
        })),
      },
    },
  });
}

export { readOnboardingProjects, readProjectOpen };
