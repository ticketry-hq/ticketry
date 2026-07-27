import { create } from "zustand";
import * as api from "../../shared/api/client";
import { ApiError } from "../../shared/api/client";
import { fetchModuleActivity, sortModulesByRecency } from "./utilities/moduleRecency";
import * as recentProjects from "./utilities/recentProjects";
import { toast } from "../../app/stores/toastStore";
import { useSelectionStore } from "../work-items/stores/selectionStore";
import type {
  Module,
  Project,
  ProjectCreate,
  ProjectPatch,
  View,
} from "../../shared/api/types";

const VIEWS: View[] = ["backlog", "settings"];
export type ProjectResourceStatus = "idle" | "loading" | "ready" | "error";

/** Coerce a raw URL segment to a known view, defaulting to backlog. */
export function normalizeView(raw: string | undefined): View {
  return raw && (VIEWS as string[]).includes(raw) ? (raw as View) : "backlog";
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

interface StudioState {
  projects: Project[];
  selectedProjectId: string | null;
  modules: Module[];
  activeView: View;
  loadingProjects: boolean;
  projectResourceStatus: ProjectResourceStatus;
  projectLoadError: string | null;
  loadingModules: boolean;
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
  projects: [],
  selectedProjectId: null,
  modules: [],
  activeView: "backlog",
  loadingProjects: false,
  projectResourceStatus: "idle",
  projectLoadError: null,
  loadingModules: false,
  error: null,

  async loadProjects() {
    if (get().projectResourceStatus === "loading") return;
    set({
      loadingProjects: true,
      projectResourceStatus: "loading",
      projectLoadError: null,
    });
    try {
      const projects = await api.listProjects();
      set({
        projects,
        loadingProjects: false,
        projectResourceStatus: "ready",
      });
    } catch (e) {
      set({
        projectLoadError: errMessage(e),
        loadingProjects: false,
        projectResourceStatus: "error",
      });
    }
  },

  async selectProject(id) {
    if (get().selectedProjectId === id) return;
    // "Used" = updated on every project switch (#665); the MRU order survives
    // reload and drives both startup selection and post-delete redirect.
    recentProjects.touch(id);
    set({ selectedProjectId: id, modules: [], loadingModules: true, error: null });
    try {
      // Fetch modules and their recency signal in parallel, then sort once here
      // so every workitems surface that reads `modules` (backlog groups,
      // EpicRail, board swimlanes, story map columns)
      // inherits the same newest-activity-first order (#831). The recency
      // signal comes through a provider seam: with no provider registered — or
      // on any failure — the map is empty and the API order is preserved.
      const [modules, activity] = await Promise.all([
        api.listModules(id),
        fetchModuleActivity(id),
      ]);
      set({ modules: sortModulesByRecency(modules, activity), loadingModules: false });
    } catch (e) {
      set({ error: errMessage(e), loadingModules: false });
    }
  },

  setView(view) {
    if (get().activeView !== view) set({ activeView: view });
  },

  async reloadModules() {
    const id = get().selectedProjectId;
    if (!id) return;
    set({ loadingModules: true, error: null });
    try {
      // Same fetch + recency sort as selectProject, so a reload after a create
      // keeps the newest-activity-first order every workitems surface reads.
      const [modules, activity] = await Promise.all([
        api.listModules(id),
        fetchModuleActivity(id),
      ]);
      set({ modules: sortModulesByRecency(modules, activity), loadingModules: false });
    } catch (e) {
      set({ error: errMessage(e), loadingModules: false });
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
    const created = await api.createModule(projectId, name);
    // Reload so both normal create and guided create preserve the same ordering.
    if (get().selectedProjectId === projectId) await get().reloadModules();
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
    const created = await api.createProject(body);
    set({ projects: [...get().projects, created] });
    return created;
  },

  async updateProject(id, patch) {
    try {
      const updated = await api.updateProject(id, patch);
      set({
        projects: get().projects.map((p) => (p.id === id ? updated : p)),
      });
      return updated;
    } catch (e) {
      toast.error(errMessage(e));
      return null;
    }
  },

  async deleteProject(id) {
    const snapshot = get().projects;
    const wasSelected = get().selectedProjectId === id;
    // Optimistic removal; restore the whole list if the request fails.
    set({ projects: snapshot.filter((p) => p.id !== id) });
    try {
      await api.deleteProject(id);
      toast.success("Project deleted");
    } catch (e) {
      set({ projects: snapshot });
      toast.error(errMessage(e));
      return { redirect: false, targetId: null };
    }

    if (!wasSelected) return { redirect: false, targetId: null };

    // The open project is gone: drop any selection it owned (not auto-cleared)
    // and resolve the MRU survivor for the caller to navigate to.
    useSelectionStore.getState().clear();
    const targetId = recentProjects.resolveStartProject(get().projects, id);
    return { redirect: true, targetId };
  },
}));
