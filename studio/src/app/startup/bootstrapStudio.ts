import {
  getOnboardingRequiredSnapshot,
  loadOnboardingState,
} from "../onboarding/onboardingStore";
import {
  getConfigSnapshot,
  isSidebarEnabled,
  loadConfig,
  selectProfile,
  sidebarPaneComposition,
  type SidebarPaneComposition,
} from "../../features/studio/stores/configStore";
import { getProjectsSnapshot } from "../../features/projects";
import { useStudioStore } from "../../features/projects";
import { resolveDefaultProject } from "../../features/studio/lib/defaultProject";
import { loadKeybindingOverrides } from "../navigation/keymapSettings";
import {
  useClientStore,
  visiblePaneOrder,
  type FocusedPane,
} from "../../state/clientStore";

export type BootstrapOutcome = "provisioning" | "unavailable" | "ready";

export async function bootstrapStudio(): Promise<BootstrapOutcome> {
  try {
    await loadBootstrapData();

    const profileIndex = preferredProfileIndex();
    if (profileIndex === null) return "provisioning";

    await selectProfile(profileIndex);
    await restoreWorkspace(profileIndex);
    return "ready";
  } catch (error) {
    console.warn("[BootstrapGate] owned profile resolve failed", error);
    return error instanceof TypeError ? "unavailable" : "provisioning";
  }
}

async function loadBootstrapData(): Promise<void> {
  await Promise.all([
    loadConfig(),
    loadKeybindingOverrides(),
    // Never rejects: the store swallows its own failure so a flaky project
    // endpoint cannot flip the bootstrap outcome away from "ready".
    loadOnboardingState(),
  ]);
}

function preferredProfileIndex(): number | null {
  const { profiles, recentProfileIndex } = getConfigSnapshot();
  if (profiles.length === 0) return null;

  const recentIndexIsValid =
    recentProfileIndex !== null &&
    recentProfileIndex >= 0 &&
    recentProfileIndex < profiles.length;

  return recentIndexIsValid ? recentProfileIndex : 0;
}

async function restoreWorkspace(profileIndex: number): Promise<void> {
  const config = getConfigSnapshot();
  const projectsEnabled = config.features.projects;
  if (!isSidebarEnabled(config)) {
    await selectResolvedProject();
    focusVisiblePane("tasks");
    return;
  }

  if (!projectsEnabled) {
    await selectResolvedProject();
    useClientStore.getState().setSidebarVisible(true);
    focusVisiblePane("modules");
    return;
  }

  const profile = getConfigSnapshot().profiles[profileIndex];
  const recentProject = getProjectsSnapshot().find(
    (project) => project.id === profile?.recent_project_id,
  );

  if (recentProject) {
    await useStudioStore.getState().selectProject(recentProject.id);
    focusVisiblePane("modules");
    return;
  }

  // A pending first run may be replaying over webview-local preferences from
  // an established workspace. Leave that preference intact for the tour to
  // capture before it temporarily reveals its anchors.
  if (!getOnboardingRequiredSnapshot()) {
    useClientStore.getState().setSidebarVisible(true);
  }
  focusVisiblePane("projects");
}

async function selectResolvedProject(): Promise<void> {
  const resolved = await resolveDefaultProject();
  await useStudioStore.getState().selectProject(resolved.id);
}

function focusVisiblePane(preferredPane: FocusedPane): void {
  const { sidebarVisible, setFocusedPane } = useClientStore.getState();
  const projectIsSelected = useStudioStore.getState().selectedProjectId !== null;
  const config = getConfigSnapshot();
  const paneComposition: SidebarPaneComposition = sidebarPaneComposition(
    config.features.projects,
    isSidebarEnabled(config),
  );
  const visiblePanes = visiblePaneOrder(
    sidebarVisible,
    projectIsSelected,
    paneComposition,
  );

  setFocusedPane(
    visiblePanes.includes(preferredPane) ? preferredPane : "tasks",
  );
}
