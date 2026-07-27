import type { Project } from "../../../shared/api/types";

// Recent-project memory (#665). A small persisted, most-recently-used-first
// list of project ids that drives BOTH startup project selection and the
// post-delete redirect, replacing the old `projects[0]` default. Pure helpers
// with no store/React coupling, mirroring the try/catch localStorage idiom of
// uiStore (navCollapsed).

const KEY = "studio.recentProjects";

/** Read the MRU id list; [] on missing / corrupt / unavailable storage. */
export function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Only startup selection and the post-delete redirect read this list, so a
// short MRU window is plenty; the cap keeps the entry from growing forever.
const MAX_RECENT = 20;

/** Move `id` to the front (most-recently-used), dedupe, cap, and persist. */
export function touch(id: string): void {
  const next = [id, ...read().filter((x) => x !== id)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore — startup falls back to projects[0] */
  }
}

/**
 * Resolve the project to open on load / after a delete: the first MRU id that
 * still exists in `projects`, else the first project, else null when there are
 * none. `excludeId` drops a just-deleted id from consideration.
 */
export function resolveStartProject(
  projects: Project[],
  excludeId?: string,
): string | null {
  const live = new Set(projects.map((p) => p.id));
  for (const id of read()) {
    if (id !== excludeId && live.has(id)) return id;
  }
  const fallback = projects.find((p) => p.id !== excludeId);
  return fallback?.id ?? null;
}
