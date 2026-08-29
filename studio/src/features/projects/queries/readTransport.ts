import type { FetchPolicy } from "@apollo/client";
import type { Module, OnboardingProject, Project } from "../../../shared/api/types";
import {
  compactWorktrackerId,
  publicWorktrackerId,
} from "../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../shared/apollo/client";
import {
  WorkTrackerOnboardingDocument,
  WorkTrackerProjectOpenDocument,
  WorkTrackerProjectsDocument,
} from "../generated/projects.documents";
import type {
  WorkTrackerProjectOpenQuery,
  WorkTrackerProjectsQuery,
} from "../generated/projects.documents";

export interface ProjectOpenResult {
  data: WorkTrackerProjectOpenQuery;
  project: Project;
  modules: Module[];
}

export interface ProjectOpenReadOptions {
  /** A post-write read must not join a request that began before the write. */
  readonly queryDeduplication?: boolean;
}

export function projectFromRow(
  row: WorkTrackerProjectsQuery["projects"]["nodes"][number],
): Project {
  const { created_at: _createdAt, ...project } = row;
  return {
    ...project,
    id: publicWorktrackerId(project.id),
  };
}

export function projectsFromResult(result: WorkTrackerProjectsQuery): Project[] {
  return result.projects.nodes
    .slice()
    .sort((left, right) =>
      left.created_at.localeCompare(right.created_at)
      || left.id.localeCompare(right.id)
    )
    .map(projectFromRow);
}

export function modulesFromProjectOpen(
  result: WorkTrackerProjectOpenQuery,
): Module[] {
  const modules = result.modules.nodes
    .filter((module) => !module.is_archived)
    .map((module): Module => ({
      id: publicWorktrackerId(module.id),
      name: module.name,
      project_id: publicWorktrackerId(module.project_id),
      sequence_id: module.sequence_id,
      key: `${module.project?.slug ?? ""}-${module.sequence_id}`,
      is_archived: module.is_archived,
      issue_type: publicWorktrackerId(module.issue_type),
    }));
  const ranks = new Map(
    result.module_presentations.nodes
      .filter((presentation) => presentation.rank !== "")
      .map((presentation) => [
        publicWorktrackerId(presentation.module_id),
        presentation.rank,
      ]),
  );
  if (ranks.size === 0) return modules;
  return modules.slice().sort((left, right) => {
    const leftRank = ranks.get(left.id) ?? "";
    const rightRank = ranks.get(right.id) ?? "";
    if (leftRank < rightRank) return -1;
    if (leftRank > rightRank) return 1;
    return left.id.localeCompare(right.id);
  });
}

export async function readProjects(): Promise<Project[]> {
  const { data } = await studioApolloClient().query({
    query: WorkTrackerProjectsDocument,
    fetchPolicy: "network-only",
  });
  return projectsFromResult(data!);
}

export async function readProjectOpen(
  projectId: string,
  fetchPolicy: FetchPolicy = "network-only",
  options: ProjectOpenReadOptions = {},
): Promise<ProjectOpenResult> {
  const { data } = await studioApolloClient().query({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: compactWorktrackerId(projectId) },
    fetchPolicy,
    context: options.queryDeduplication === false
      ? { queryDeduplication: false }
      : undefined,
  });
  const row = data!.project.nodes[0];
  if (!row) throw new Error(`Project ${projectId} was not found.`);
  return {
    data: data!,
    project: projectFromRow(row),
    modules: modulesFromProjectOpen(data!),
  };
}

export async function readModules(projectId: string): Promise<Module[]> {
  return (await readProjectOpen(projectId)).modules;
}

/**
 * Every project's onboarding state, in creation order.
 *
 * Onboarding belongs to the installation project, and which project that is
 * depends on the slugs present, so the read returns the whole ordered list and
 * lets the caller apply that one rule.
 */
export async function readOnboardingProjects(): Promise<OnboardingProject[]> {
  const { data } = await studioApolloClient().query({
    query: WorkTrackerOnboardingDocument,
    fetchPolicy: "network-only",
  });
  return data!.projects.nodes.map((project) => ({
    ...project,
    id: publicWorktrackerId(project.id),
  }));
}
