import { useTasksStore } from "../stores/tasksStore";
import type { ProjectSummary } from "./types";

export const DEFAULT_PROJECT_KEY = "CDN";
export const LEGACY_PROJECT_KEY = "CODING";

function findDefaultProject(projects: ProjectSummary[]): ProjectSummary | null {
  return (
    projects.find((project) => project.identifier === DEFAULT_PROJECT_KEY) ??
    projects.find((project) => project.identifier === LEGACY_PROJECT_KEY) ??
    null
  );
}

/** Resolve the installation's default project, creating canonical Coding last. */
export async function resolveDefaultProject(): Promise<ProjectSummary> {
  const tasks = useTasksStore.getState();
  const existing = findDefaultProject(tasks.projects);
  if (existing) return existing;

  try {
    return await tasks.createProject({
      name: "Coding",
      slug: DEFAULT_PROJECT_KEY,
    });
  } catch {
    // Another bootstrap/onboarding attempt may have created the project first.
    // Refresh once and prefer the authoritative row before reporting failure.
    await tasks.loadProjects();
    const refreshed = findDefaultProject(useTasksStore.getState().projects);
    if (refreshed) return refreshed;
    throw new Error("The resolved default project is unavailable.");
  }
}
