import { useQuery } from "@apollo/client/react";
import {
  deleteProfile as deleteProfileRecord,
  patchConfig,
  postProfile as postProfileRecord,
  putProfile as putProfileRecord,
} from "../../settings/profileTransport";
import { type ConfigPayload, type Profile } from "../lib/types";
import { studioApolloClient } from "../../../shared/apollo/client";
import { LoadLocalSettingsDocument } from "../../settings/generated/profileSettings.documents";
import { isAbsoluteFolderPath } from "../lib/moduleFolderPath";

// Server config (profiles + feature flags) lives in Apollo's LoadLocalSettings
// holding. Components and imperative bootstrap code read the same cache entry.

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

function toQueryData(snapshot: ConfigSnapshot) {
  return {
    __typename: "LocalSettings",
    recent_profile_index: snapshot.recentProfileIndex,
    profiles: snapshot.profiles.map((profile) => ({
      name: profile.name,
      workspace_slug: profile.workspace_slug,
      agent_prompt: profile.agent_prompt,
      agent_prompts: profile.agent_prompts,
      recent_project_id: profile.recent_project_id ?? null,
      recent_module_ids: profile.recent_module_ids ?? {},
      module_links: profile.module_links,
    })),
    features: snapshot.features,
  };
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
  studioApolloClient().writeQuery({
    query: LoadLocalSettingsDocument,
    data: { local_settings: toQueryData(snapshot) },
  });
  return snapshot;
}

/** The cached config, or the empty default before the first load resolves. */
export function getConfigSnapshot(): ConfigSnapshot {
  const data = studioApolloClient().readQuery({ query: LoadLocalSettingsDocument });
  return data
    ? toSnapshot(data.local_settings as unknown as ConfigPayload)
    : EMPTY_CONFIG;
}

/** Explicit reload (page load, external change): always hits the server. */
export async function loadConfig(): Promise<ConfigSnapshot> {
  const { data } = await studioApolloClient().query({
    query: LoadLocalSettingsDocument,
    fetchPolicy: "network-only",
  });
  return toSnapshot(data!.local_settings as unknown as ConfigPayload);
}

/** Subscribe to the config; renders the empty default until loaded. */
export function useConfig(): ConfigSnapshot {
  const { data } = useQuery(LoadLocalSettingsDocument, {
    client: studioApolloClient(),
  });
  return data
    ? toSnapshot(data.local_settings as unknown as ConfigPayload)
    : EMPTY_CONFIG;
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
  studioApolloClient().writeQuery({
    query: LoadLocalSettingsDocument,
    data: { local_settings: toQueryData(next) },
  });
  return next;
}

export async function selectProfile(index: number): Promise<void> {
  acceptConfig(await patchConfig({ recent_profile_index: index }));
  const { loadProjects } = await import("../../projects");
  await loadProjects();
}

export async function createProfile(body: Partial<Profile>): Promise<void> {
  acceptConfig(await postProfileRecord(body));
}

export async function updateProfile(
  index: number,
  body: Partial<Profile>,
): Promise<void> {
  acceptConfig(await putProfileRecord(index, body));
}

export async function deleteProfile(index: number): Promise<void> {
  acceptConfig(await deleteProfileRecord(index));
}

export async function setModuleFolder(
  moduleId: string,
  path: string,
): Promise<void> {
  if (!isAbsoluteFolderPath(path)) {
    throw new Error("Module folders require a complete filesystem path.");
  }
  const { recentProfileIndex, profiles } = getConfigSnapshot();
  if (recentProfileIndex === null) return;
  const profile = profiles[recentProfileIndex];
  if (!profile) return;
  const linkIndex = profile.module_links.findIndex(
    (link) => link.module_id === moduleId,
  );
  const moduleLink = { module_id: moduleId, path };
  const moduleLinks =
    linkIndex === -1
      ? [...profile.module_links, moduleLink]
      : profile.module_links.map((link, index) =>
          index === linkIndex ? moduleLink : link,
        );
  await updateProfile(recentProfileIndex, {
    ...profile,
    module_links: moduleLinks,
  });
}

export function getModuleFolder(
  profile: Pick<Profile, "module_links"> | null | undefined,
  moduleId: string,
): string | undefined {
  return profile?.module_links.find((link) => link.module_id === moduleId)?.path;
}

export function isSidebarEnabled(
  state: Pick<ConfigSnapshot, "features"> = getConfigSnapshot(),
): boolean {
  return state.features.sidebar;
}
