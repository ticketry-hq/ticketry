import { create } from "zustand";
import * as api from "../../shared/api/client";
import { ApiError } from "../../shared/api/client";
import * as recentProjects from "./utilities/recentProjects";
import { toast } from "../../state/clientStore";
import { useClientStore } from "../../state/clientStore";
import {
  createProjectRecord,
  deleteProjectRecord,
  getModulesSnapshot,
  getProjectsSnapshot,
  loadModules,
  loadProjects,
  updateProjectRecord,
} from "./queries";
import { markModuleCreated } from "./internal/newlyCreatedModules";
import type {
  Module,
  Project,
  ProjectCreate,
  ProjectPatch,
  View,
} from "../../shared/api/types";
import { loadIssueTypes } from "../settings";
import { getConfigSnapshot } from "../studio/stores/configStore";

const VIEWS: View[] = ["backlog", "settings"];

/** Coerce a raw URL segment to a known view, defaulting to backlog. */
export function normalizeView(raw: string | undefined): View {
  return raw && (VIEWS as string[]).includes(raw) ? (raw as View) : "backlog";
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

// Client-only state: which project is open and which view is active. The
// project and module lists themselves live in the TanStack Query cache
// (features/projects/queries.ts); components subscribe with
// useProjectsQuery/useModulesQuery.
interface StudioState {
  selectedProjectId: string | null;
  activeView: View;
  error: string | null;

  loadProjects: () => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  setView: (view: View) => void;

  // Re-fetch + re-sort the selected project's modules (after a create, #919).
  reloadModules: () => Promise<void>;
  // Create a module in the selected project, reload the list, and return the
  // created module so the caller can auto-select it (#919 Slice A).
  createModule: (name: string) => Promise<Module | null>;
  createModuleForProjectWithError: (projectId: string, name: string) => Promise<Module>;

  // Project CRUD (#665). create appends + returns the new project (the caller
  // navigates into it); update replaces the row; delete removes it and reports
  // where to redirect when the deleted project was the open one.
  createProject: (body: ProjectCreate) => Promise<Project | null>;
  createProjectWithError: (body: ProjectCreate) => Promise<Project>;
  updateProject: (id: string, patch: ProjectPatch) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<DeleteProjectResult>;
}

/**
 * Outcome of a delete. `redirect` is true only when the *selected* project was
 * removed and the caller must navigate; `targetId` is the most-recently-used
 * surviving project to open, or null when none remain (→ create screen).
 */
export interface DeleteProjectResult {
  redirect: boolean;
  targetId: string | null;
}

export const useStudioStore = create<StudioState>((set, get) => ({
  selectedProjectId: null,
  activeView: "backlog",
  error: null,

  async loadProjects() {
    try {
      await loadProjects();
    } catch {
      // Load state and errors live on the query; callers that render them
      // subscribe through useProjectsQuery.
    }
  },

  async selectProject(id) {
    if (get().selectedProjectId === id) return;
    // "Used" = updated on every project switch (#665); the MRU order survives
    // reload and drives both startup selection and post-delete redirect.
    recentProjects.touch(id);
    set({ selectedProjectId: id, error: null });
    useClientStore.setState({
      selectedModuleId: null,
      selectedTaskId: null,
      workspaceSelection: { kind: "task" },
    });
    try {
      await loadModules(id);
      const { recentProfileIndex, profiles } = getConfigSnapshot();
      const recentModuleId =
        recentProfileIndex === null
          ? undefined
          : profiles[recentProfileIndex]?.recent_module_ids?.[id];
      if (
        recentModuleId &&
        getModulesSnapshot(id).some((module) => module.id === recentModuleId)
      ) {
        await useClientStore.getState().selectModule(recentModuleId);
      }
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  setView(view) {
    if (get().activeView !== view) set({ activeView: view });
  },

  async reloadModules() {
    const id = get().selectedProjectId;
    if (!id) return;
    set({ error: null });
    try {
      await loadModules(id);
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  async createModule(name) {
    const projectId = get().selectedProjectId;
    if (!projectId) return null;
    try {
      return await get().createModuleForProjectWithError(projectId, name);
    } catch (e) {
      toast.error(errMessage(e));
      return null;
    }
  },

  async createModuleForProjectWithError(projectId, name) {
    const issueTypes = await loadIssueTypes(projectId);
    const moduleType = issueTypes.find(
      (issueType) => issueType.level === "module" && issueType.name === "Module",
    );
    if (!moduleType) throw new Error("The Module issue type is unavailable.");
    const created = await api.createModule(projectId, name, moduleType.id);
    // Recorded before the reload so the canonical order that reload produces
    // already leads with the new module, in either ordering mode (#366).
    markModuleCreated(projectId, created.id);
    // Reload so both normal create and guided create preserve the same ordering.
    await loadModules(projectId).catch(() => {});
    return created;
  },

  // --- project CRUD (#665) --------------------------------------------------

  async createProject(body) {
    try {
      return await get().createProjectWithError(body);
    } catch (e) {
      // Duplicate-slug 409 (and any other failure) surfaces as a toast; the
      // caller's form stays open with its values intact.
      toast.error(errMessage(e));
      return null;
    }
  },

  async createProjectWithError(body) {
    return createProjectRecord(body);
  },

  async updateProject(id, patch) {
    try {
      return await updateProjectRecord(id, patch);
    } catch (e) {
      toast.error(errMessage(e));
      return null;
    }
  },

  async deleteProject(id) {
    const wasSelected = get().selectedProjectId === id;
    try {
      await deleteProjectRecord(id);
      toast.success("Project deleted");
    } catch (e) {
      toast.error(errMessage(e));
      return { redirect: false, targetId: null };
    }

    if (!wasSelected) return { redirect: false, targetId: null };

    // The open project is gone: drop any selection it owned (not auto-cleared)
    // and resolve the MRU survivor for the caller to navigate to.
    useClientStore.getState().selectionClear();
    const targetId = recentProjects.resolveStartProject(getProjectsSnapshot(), id);
    return { redirect: true, targetId };
  },
}));
