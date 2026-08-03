import { useQuery } from "@tanstack/react-query";
import * as api from "../lib/api";
import { type ConfigPayload, type Profile } from "../lib/types";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";

// Server config (profiles + feature flags) lives in the TanStack Query cache
// under queryKeys.config — this module is the one place that reads and writes
// that entry. Components subscribe through useConfig(); non-React code
// (bootstrap, stores) uses the imperative functions, which share the same
// cache entry the hooks render from.

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

export interface ConfigSnapshot {
  profiles: Profile[];
  recentProfileIndex: number | null;
  features: {
    sidebar: boolean;
    projects: boolean;
  };
}

const EMPTY_CONFIG: ConfigSnapshot = {
  profiles: [],
  recentProfileIndex: null,
  features: { sidebar: false, projects: false },
};

function toSnapshot(payload: ConfigPayload): ConfigSnapshot {
  return {
    profiles: payload.profiles,
    recentProfileIndex: payload.recent_profile_index,
    features: payload.features,
  };
}

async function fetchConfig(): Promise<ConfigSnapshot> {
  return toSnapshot(await api.getConfig());
}

// Profile mutations return the refreshed profile list; feature flags are not
// part of every mutation payload, so the cached flags are preserved unless
// the response actually carries them.
function acceptConfig(payload: ConfigPayload): ConfigSnapshot {
  const snapshot: ConfigSnapshot = {
    profiles: payload.profiles,
    recentProfileIndex: payload.recent_profile_index,
    features: payload.features ?? getConfigSnapshot().features,
  };
  queryClient.setQueryData(queryKeys.config, snapshot);
  return snapshot;
}

/** The cached config, or the empty default before the first load resolves. */
export function getConfigSnapshot(): ConfigSnapshot {
  return (
    queryClient.getQueryData<ConfigSnapshot>(queryKeys.config) ?? EMPTY_CONFIG
  );
}

/** Explicit reload (page load, external change): always hits the server. */
export async function loadConfig(): Promise<ConfigSnapshot> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.config,
    queryFn: fetchConfig,
    staleTime: 0,
  });
}

/** Subscribe to the config; renders the empty default until loaded. */
export function useConfig(): ConfigSnapshot {
  // The app-level queryClient is passed explicitly so the hook works without
  // a provider in the tree (component tests, isolated hosts).
  const { data } = useQuery(
    {
      queryKey: queryKeys.config,
      queryFn: fetchConfig,
    },
    queryClient,
  );
  return data ?? EMPTY_CONFIG;
}

/**
 * Test seam: seed or patch the cached config without a network round-trip.
 * Merges over the current snapshot (or the empty default).
 */
export function seedConfig(
  update:
    | Partial<ConfigSnapshot>
    | ((current: ConfigSnapshot) => Partial<ConfigSnapshot>),
): ConfigSnapshot {
  const current = getConfigSnapshot();
  const partial = typeof update === "function" ? update(current) : update;
  const next = { ...current, ...partial };
  queryClient.setQueryData(queryKeys.config, next);
  return next;
}

export async function selectProfile(index: number): Promise<void> {
  await api.patchConfig({ recent_profile_index: index });
  queryClient.setQueryData<ConfigSnapshot>(queryKeys.config, (old) =>
    old ? { ...old, recentProfileIndex: index } : old,
  );
  // Selecting a profile loads its projects. The project tree lives in the
  // tasks store; dynamic import keeps the configStore ↔ tasksStore cycle from
  // biting at module-eval time.
  const { useTasksStore } = await import("./tasksStore");
  await useTasksStore.getState().loadProjects();
}

export async function createProfile(body: Partial<Profile>): Promise<void> {
  acceptConfig(await api.postProfile(body));
}

export async function updateProfile(
  index: number,
  body: Partial<Profile>,
): Promise<void> {
  acceptConfig(await api.putProfile(index, body));
}

export async function deleteProfile(index: number): Promise<void> {
  acceptConfig(await api.deleteProfile(index));
}

export async function setModuleFolder(
  moduleId: string,
  path: string,
): Promise<void> {
  const { recentProfileIndex, profiles } = getConfigSnapshot();
  if (recentProfileIndex === null) return;
  const profile = profiles[recentProfileIndex];
  if (!profile) return;
  await updateProfile(recentProfileIndex, {
    ...profile,
    module_folders: { ...profile.module_folders, [moduleId]: path },
  });
}

export function isSidebarEnabled(
  state: Pick<ConfigSnapshot, "features"> = getConfigSnapshot(),
): boolean {
  return state.features.sidebar;
}
