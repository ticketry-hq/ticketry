import {
  createProjectRecord,
  getProjectsSnapshot,
  loadProjects,
} from "../../projects";
import type { Project } from "../../../shared/api/types";

export const DEFAULT_PROJECT_KEY = "CDN";
export const LEGACY_PROJECT_KEY = "CODING";

function findDefaultProject(projects: Project[]): Project | null {
  return (
    projects.find((project) => project.slug === DEFAULT_PROJECT_KEY) ??
    projects.find((project) => project.slug === LEGACY_PROJECT_KEY) ??
    null
  );
}

/** Resolve the installation's default project, creating canonical Coding last. */
export async function resolveDefaultProject(): Promise<Project> {
  const existing = findDefaultProject(getProjectsSnapshot());
  if (existing) return existing;

  try {
    return await createProjectRecord({
      name: "Coding",
      slug: DEFAULT_PROJECT_KEY,
    });
  } catch {
    // Another bootstrap/onboarding attempt may have created the project first.
    // Refresh once and prefer the authoritative row before reporting failure.
    await loadProjects();
    const refreshed = findDefaultProject(getProjectsSnapshot());
    if (refreshed) return refreshed;
    throw new Error("The resolved default project is unavailable.");
  }
}
