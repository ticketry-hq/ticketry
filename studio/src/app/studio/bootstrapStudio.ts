import { useOnboardingStore } from "../onboarding/onboardingStore";
import {
  getConfigSnapshot,
  isSidebarEnabled,
  loadConfig,
  selectProfile,
  sidebarPaneComposition,
  type SidebarPaneComposition,
} from "../../features/studio/stores/configStore";
import { useTasksStore } from "../../features/studio/stores/tasksStore";
import { loadKeybindingOverrides } from "../navigation/keymapSettings";
import {
  useUIStore,
  visiblePaneOrder,
  type FocusedPane,
} from "../../features/studio/stores/uiStore";

export type BootstrapOutcome = "provisioning" | "unavailable" | "ready";

const DEFAULT_PROJECT_KEY = "CDN";
const LEGACY_PROJECT_KEY = "CODING";

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
    // Never rejects: the store swallows its own failure so a flaky workspace
    // endpoint cannot flip the bootstrap outcome away from "ready".
    useOnboardingStore.getState().loadWorkspaceState(),
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
    useUIStore.getState().setSidebarVisible(true);
    focusVisiblePane("modules");
    return;
  }

  const profile = getConfigSnapshot().profiles[profileIndex];
  const recentProject = useTasksStore
    .getState()
    .projects.find((project) => project.id === profile?.recent_project_id);

  if (recentProject) {
    await useTasksStore.getState().selectProject(recentProject.id);
    focusVisiblePane("modules");
    return;
  }

  // A pending first run may be replaying over webview-local preferences from
  // an established workspace. Leave that preference intact for the tour to
  // capture before it temporarily reveals its anchors.
  if (!useOnboardingStore.getState().onboardingRequired) {
    useUIStore.getState().setSidebarVisible(true);
  }
  focusVisiblePane("projects");
}

async function selectResolvedProject(): Promise<void> {
  const tasks = useTasksStore.getState();
  let resolved =
    tasks.projects.find(
      (project) => project.identifier === DEFAULT_PROJECT_KEY,
    ) ??
    tasks.projects.find(
      (project) => project.identifier === LEGACY_PROJECT_KEY,
    );

  if (!resolved) {
    try {
      resolved = await tasks.createProject({
        name: "coding",
        slug: DEFAULT_PROJECT_KEY,
      });
    } catch {
      // A concurrent bootstrap may have resolved the project first. Refresh
      // once and use that authoritative row instead of duplicating resolution
      // policy in project-scoped code paths.
      await tasks.loadProjects();
      const refreshedProjects = useTasksStore.getState().projects;
      resolved =
        refreshedProjects.find(
          (project) => project.identifier === DEFAULT_PROJECT_KEY,
        ) ??
        refreshedProjects.find(
          (project) => project.identifier === LEGACY_PROJECT_KEY,
        );
      if (!resolved) {
        throw new Error("The resolved default project is unavailable.");
      }
    }
  }

  await useTasksStore.getState().selectProject(resolved.id);
}

function focusVisiblePane(preferredPane: FocusedPane): void {
  const { sidebarVisible, setFocusedPane } = useUIStore.getState();
  const projectIsSelected = useTasksStore.getState().selectedProjectId !== null;
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
