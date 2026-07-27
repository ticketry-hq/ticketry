import { create } from "zustand";
import * as api from "../api/agentApi";
import type { Profile } from "../types";

interface AgentConfigStoreState {
  profiles: Profile[];
  recentProfileIndex: number | null;
  loadConfig: () => Promise<void>;
  selectProfile: (index: number) => Promise<void>;
  createProfile: (body: Partial<Profile>) => Promise<void>;
  updateProfile: (index: number, body: Partial<Profile>) => Promise<void>;
  deleteProfile: (index: number) => Promise<void>;
  setModuleFolder: (moduleId: string, path: string) => Promise<void>;
}

export const useConfigStore = create<AgentConfigStoreState>((set, get) => ({
  profiles: [],
  recentProfileIndex: null,
  async loadConfig() {
    const config = await api.getConfig();
    set({
      profiles: config.profiles,
      recentProfileIndex: config.recent_profile_index,
    });
  },
  async selectProfile(index) {
    await api.patchConfig({ recent_profile_index: index });
    set({ recentProfileIndex: index });
  },
  async createProfile(body) {
    const config = await api.postProfile(body);
    set({ profiles: config.profiles, recentProfileIndex: config.recent_profile_index });
  },
  async updateProfile(index, body) {
    const config = await api.putProfile(index, body);
    set({ profiles: config.profiles, recentProfileIndex: config.recent_profile_index });
  },
  async deleteProfile(index) {
    const config = await api.deleteProfile(index);
    set({ profiles: config.profiles, recentProfileIndex: config.recent_profile_index });
  },
  async setModuleFolder(moduleId, path) {
    const { recentProfileIndex, profiles } = get();
    if (recentProfileIndex === null || !profiles[recentProfileIndex]) return;
    const profile = profiles[recentProfileIndex];
    await get().updateProfile(recentProfileIndex, {
      ...profile,
      module_folders: { ...profile.module_folders, [moduleId]: path },
    });
  },
}));
