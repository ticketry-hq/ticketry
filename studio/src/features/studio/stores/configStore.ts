import { type Profile } from "../lib/types";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";

// Retained only as an in-memory compatibility seam for older component tests.
// Production code no longer imports this module or reads host configuration.

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

/** The cached config, or the empty default before the first load resolves. */
export function getConfigSnapshot(): ConfigSnapshot {
  return (
    queryClient.getQueryData<ConfigSnapshot>(queryKeys.config) ?? EMPTY_CONFIG
  );
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
