import { create } from "zustand";
import * as api from "../lib/api";
import { type Profile } from "../lib/types";

export type SidebarPaneComposition =
  | "absent"
  | "modules"
  | "projects-and-modules";

export function sidebarPaneComposition(
  projectsEnabled: boolean,
  sidebarEnabled = true,
): SidebarPaneComposition {
  if (!sidebarEnabled) return "absent";
  return projectsEnabled ? "projects-and-modules" : "modules";
}

interface ConfigStoreState {
  profiles: Profile[];
  recentProfileIndex: number | null;
  features: {
    sidebar: boolean;
    projects: boolean;
  };

  loadConfig: () => Promise<void>;
  selectProfile: (index: number) => Promise<void>;
  createProfile: (body: Partial<Profile>) => Promise<void>;
  updateProfile: (index: number, body: Partial<Profile>) => Promise<void>;
  deleteProfile: (index: number) => Promise<void>;
  setModuleFolder: (moduleId: string, path: string) => Promise<void>;
}

export const useConfigStore = create<ConfigStoreState>((set, get) => ({
  profiles: [],
  recentProfileIndex: null,
  features: { sidebar: false, projects: false },

  async loadConfig() {
    const cfg = await api.getConfig();
    set({
      profiles: cfg.profiles,
      recentProfileIndex: cfg.recent_profile_index,
      features: cfg.features,
    });
  },

  async selectProfile(index: number) {
    await api.patchConfig({ recent_profile_index: index });
    set({ recentProfileIndex: index });
    // Selecting a profile loads its projects. The project tree lives in the
    // tasks store; dynamic import keeps the configStore ↔ tasksStore cycle from
    // biting at module-eval time.
    const { useTasksStore } = await import("./tasksStore");
    await useTasksStore.getState().loadProjects();
  },

  async createProfile(body) {
    const cfg = await api.postProfile(body);
    set({ profiles: cfg.profiles, recentProfileIndex: cfg.recent_profile_index });
  },

  async updateProfile(index, body) {
    const cfg = await api.putProfile(index, body);
    set({ profiles: cfg.profiles, recentProfileIndex: cfg.recent_profile_index });
  },

  async deleteProfile(index) {
    const cfg = await api.deleteProfile(index);
    set({ profiles: cfg.profiles, recentProfileIndex: cfg.recent_profile_index });
  },

  async setModuleFolder(moduleId: string, path: string) {
    const { recentProfileIndex, profiles } = get();
    if (recentProfileIndex === null) return;
    const profile = profiles[recentProfileIndex];
    if (!profile) return;
    await get().updateProfile(recentProfileIndex, {
      ...profile,
      module_folders: { ...profile.module_folders, [moduleId]: path },
    });
  },
}));

export function isSidebarEnabled(
  state: Pick<ConfigStoreState, "features"> = useConfigStore.getState(),
): boolean {
  return state.features.sidebar;
}
