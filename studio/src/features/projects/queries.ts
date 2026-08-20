import { useQuery } from "@tanstack/react-query";
import * as api from "../../shared/api/client";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import type {
  Module,
  Project,
  ProjectCreate,
  ProjectPatch,
} from "../../shared/api/types";

// Server-owned project + module lists, cached under queryKeys.projects /
// queryKeys.modules. Full backend shapes (Project, Module) are the canonical
// cache entries; surfaces needing a slimmer projection derive it at read time.

const EMPTY_PROJECTS: Project[] = [];
const EMPTY_MODULES: Module[] = [];

async function fetchProjects(): Promise<Project[]> {
  return api.listProjects();
}

// Modules are cached already in the Canonical module order: every consumer
// (sidebar, module tabs, Epic derive, backlog groups, position shortcuts)
// reads that one server-ordered array (#831, #359).
const fetchModules = (projectId: string): Promise<Module[]> =>
  api.listModules(projectId);

/** Cached projects, [] before the first load resolves. */
export function getProjectsSnapshot(): Project[] {
  return queryClient.getQueryData<Project[]>(queryKeys.projects.all) ?? [];
}

/** Cached modules for one project, [] when absent. */
export function getModulesSnapshot(projectId: string | null): Module[] {
  if (!projectId) return [];
  return (
    queryClient.getQueryData<Module[]>(queryKeys.modules.byProject(projectId)) ??
    []
  );
}

export async function loadProjects(): Promise<Project[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.projects.all,
    queryFn: fetchProjects,
    staleTime: 0,
  });
}

export async function loadModules(projectId: string): Promise<Module[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.modules.byProject(projectId),
    queryFn: () => fetchModules(projectId),
    staleTime: 0,
  });
}

/**
 * Subscribe to the cached lists WITHOUT fetching. Surfaces that read along with
 * whoever owns the load (Studio's panes) use these so a create or refresh
 * re-renders them, without each pane issuing its own request.
 */
export function useCachedProjects(): Project[] {
  const { data } = useQuery(
    { queryKey: queryKeys.projects.all, queryFn: fetchProjects, enabled: false },
    queryClient,
  );
  return data ?? EMPTY_PROJECTS;
}

export function useCachedModules(projectId: string | null): Module[] {
  const { data } = useQuery(
    {
      queryKey: queryKeys.modules.byProject(projectId ?? "none"),
      queryFn: () => fetchModules(projectId!),
      enabled: false,
    },
    queryClient,
  );
  return data ?? EMPTY_MODULES;
}

export function useProjectsQuery() {
  return useQuery(
    {
      queryKey: queryKeys.projects.all,
      queryFn: fetchProjects,
    },
    queryClient,
  );
}

/** Subscribe to a project's modules; disabled (empty) until a project exists. */
export function useModulesQuery(projectId: string | null) {
  return useQuery(
    {
      queryKey: queryKeys.modules.byProject(projectId ?? "none"),
      queryFn: () => fetchModules(projectId!),
      enabled: projectId !== null,
    },
    queryClient,
  );
}

export async function createProjectRecord(body: ProjectCreate): Promise<Project> {
  const created = await api.createProject(body);
  queryClient.setQueryData<Project[]>(queryKeys.projects.all, (old) =>
    old && !old.some((project) => project.id === created.id)
      ? [...old, created]
      : old ?? [created],
  );
  return created;
}

export async function updateProjectRecord(
  id: string,
  patch: ProjectPatch,
): Promise<Project> {
  const updated = await api.updateProject(id, patch);
  queryClient.setQueryData<Project[]>(queryKeys.projects.all, (old) =>
    old?.map((project) => (project.id === id ? updated : project)),
  );
  return updated;
}

export async function deleteProjectRecord(id: string): Promise<void> {
  await api.deleteProject(id);
  queryClient.setQueryData<Project[]>(queryKeys.projects.all, (old) =>
    old?.filter((project) => project.id !== id),
  );
  queryClient.removeQueries({ queryKey: queryKeys.modules.byProject(id) });
}

/** Test seam: seed the cached project list. */
export function seedProjects(projects: Project[]): void {
  queryClient.setQueryData(queryKeys.projects.all, projects);
}

/** Test seam: seed one project's cached module list. */
export function seedModules(projectId: string, modules: Module[]): void {
  queryClient.setQueryData(queryKeys.modules.byProject(projectId), modules);
}
