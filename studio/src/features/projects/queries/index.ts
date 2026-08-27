import { skipToken, useQuery } from "@apollo/client/react";
import { useEffect, useState } from "react";
import type { Module, Project, ProjectCreate, ProjectPatch } from "../../../shared/api/types";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../shared/apollo/client";
import {
  WorkTrackerProjectOpenDocument,
  WorkTrackerProjectsDocument,
} from "../generated/projects.documents";
import type { WorkTrackerProjectsQuery } from "../generated/projects.documents";
import {
  createProject as writeProject,
  deleteProject as removeProject,
  updateProject as writeProjectUpdate,
} from "../mutationTransport";
import { applyCanonicalModuleOrder } from "../utilities/canonicalModuleOrder";
import { forgetAcceptedManualModuleOrder } from "../internal/acceptedManualModuleOrder";
import { forgetNewlyCreatedModules } from "../internal/newlyCreatedModules";
import {
  modulesFromProjectOpen,
  projectsFromResult,
  readProjects,
  readProjectOpen,
  readWorkspace,
} from "./readTransport";

const EMPTY_PROJECTS: Project[] = [];
const EMPTY_MODULES: Module[] = [];

function canonicalModules(projectId: string, data: {
  project: { nodes: Array<{ manual_module_order: boolean }> };
  modules: Parameters<typeof modulesFromProjectOpen>[0]["modules"];
}): Module[] {
  const modules = modulesFromProjectOpen(data as Parameters<typeof modulesFromProjectOpen>[0]);
  // The consolidated query is already ordered by the server. Automatic
  // activity ordering is applied by the asynchronous open path below.
  void projectId;
  return modules;
}

export function getProjectsSnapshot(): Project[] {
  const data = studioApolloClient().readQuery({ query: WorkTrackerProjectsDocument });
  return data ? projectsFromResult(data) : [];
}

export function getModulesSnapshot(projectId: string | null): Module[] {
  if (!projectId) return [];
  const data = studioApolloClient().readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: compactWorktrackerId(projectId) },
    optimistic: true,
  });
  return data ? canonicalModules(projectId, data) : [];
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
    variables: { projectId: compactWorktrackerId(projectId) },
    data: opened.data,
  });
  const ordered = await applyCanonicalModuleOrder(
    projectId,
    opened.modules,
    opened.project.manual_module_order,
  );
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
          variables: { projectId: compactWorktrackerId(projectId) },
          client: studioApolloClient(),
          fetchPolicy: "cache-only",
        }
      : skipToken,
  );
  return projectId && query.data
    ? canonicalModules(projectId, query.data)
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
          variables: { projectId: compactWorktrackerId(projectId) },
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
    let active = true;
    setLoading(true);
    void loadModules(projectId).then(
      () => { if (active) setError(undefined); },
      (cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause : new Error(String(cause)));
      },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);
  return {
    ...query,
    data: projectId && query.data
      ? canonicalModules(projectId, query.data)
      : undefined,
    error: error ?? query.error,
    loading,
    isPending: loading,
  };
}

export async function createProjectRecord(body: ProjectCreate): Promise<Project> {
  const created = await writeProject(body);
  const projects = getProjectsSnapshot();
  seedProjects(projects.some((project) => project.id === created.id)
    ? projects
    : [...projects, created]);
  return created;
}

export async function updateProjectRecord(
  id: string,
  patch: ProjectPatch,
): Promise<Project> {
  const updated = await writeProjectUpdate(id, patch);
  seedProjects(getProjectsSnapshot().map((project) =>
    project.id === id ? updated : project
  ));
  return updated;
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
  forgetAcceptedManualModuleOrder(id);
  forgetNewlyCreatedModules(id);
}

export function seedProjects(projects: Project[]): void {
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectsDocument,
    data: {
      projects: {
        __typename: "WorktrackerProjectConnection",
        nodes: projects.map((project, index) => ({
          __typename: "WorktrackerProject",
          id: compactWorktrackerId(project.id),
          name: project.name,
          slug: project.slug,
          description: project.description,
          manual_module_order: project.manual_module_order ?? false,
          created_at: new Date(index).toISOString(),
        })),
      },
    } as unknown as WorkTrackerProjectsQuery,
  });
}

export function seedModules(projectId: string, modules: Module[]): void {
  const variables = { projectId: compactWorktrackerId(projectId) };
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
        nodes: modules.map((module, index) => ({
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
            slug: current.project.nodes[0]?.slug ?? module.key.split("-")[0] ?? "",
            manual_module_order: current.project.nodes[0]?.manual_module_order ?? false,
          },
        })),
      },
    },
  });
}

export { readProjectOpen, readWorkspace };
