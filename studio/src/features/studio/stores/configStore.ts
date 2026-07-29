import { create } from "zustand";
import * as api from "../lib/api";
import { type Profile } from "../lib/types";

interface ConfigStoreState {
  profiles: Profile[];
  recentProfileIndex: number | null;
  features: {
    projects: boolean;
  };

  loadConfig: () => Promise<void>;
  selectProfile: (index: number) => Promise<void>;
  createProfile: (body: Partial<Profile> & { api_key: string }) => Promise<void>;
  updateProfile: (index: number, body: Partial<Profile> & { api_key: string }) => Promise<void>;
  deleteProfile: (index: number) => Promise<void>;
  setModuleFolder: (moduleId: string, path: string) => Promise<void>;
}

export const useConfigStore = create<ConfigStoreState>((set, get) => ({
  profiles: [],
  recentProfileIndex: null,
  features: { projects: false },

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
    const nextFolders = { ...profile.module_folders, [moduleId]: path };
    await get().updateProfile(recentProfileIndex, {
      name: profile.name,
      api_url: profile.api_url,
      api_key: profile.api_key ?? "",
      workspace_slug: profile.workspace_slug,
      agent_prompt: profile.agent_prompt,
      agent_prompts: profile.agent_prompts,
      module_folders: nextFolders,
      recent_project_id: profile.recent_project_id ?? null,
      recent_module_ids: profile.recent_module_ids ?? {},
    });
  },
}));
