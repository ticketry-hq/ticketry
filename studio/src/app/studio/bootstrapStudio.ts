import { useConfigStore as useAgentConfigStore } from "../../features/agents/stores/configStore";
import { useOnboardingStore } from "../onboarding/onboardingStore";
import { useConfigStore } from "../../features/studio/stores/configStore";
import { useTasksStore } from "../../features/studio/stores/tasksStore";
import { loadKeybindingOverrides } from "../navigation/keymapSettings";
import {
  useUIStore,
  visiblePaneOrder,
  type FocusedPane,
} from "../../features/studio/stores/uiStore";

export type BootstrapOutcome = "provisioning" | "unavailable" | "ready";

export async function bootstrapStudio(): Promise<BootstrapOutcome> {
  try {
    await loadBootstrapData();

    const profileIndex = preferredProfileIndex();
    if (profileIndex === null) return "provisioning";

    await useConfigStore.getState().selectProfile(profileIndex);
    await restoreWorkspace(profileIndex);
    return "ready";
  } catch (error) {
    console.warn("[BootstrapGate] owned profile resolve failed", error);
    return error instanceof TypeError ? "unavailable" : "provisioning";
  }
}

async function loadBootstrapData(): Promise<void> {
  await Promise.all([
    useConfigStore.getState().loadConfig(),
    useAgentConfigStore.getState().loadConfig(),
    useUIStore.getState().hydratePanelLayout(),
    loadKeybindingOverrides(),
    // Never rejects: the store swallows its own failure so a flaky workspace
    // endpoint cannot flip the bootstrap outcome away from "ready".
    useOnboardingStore.getState().loadWorkspaceState(),
  ]);
}

function preferredProfileIndex(): number | null {
  const { profiles, recentProfileIndex } = useConfigStore.getState();
  if (profiles.length === 0) return null;

  const recentIndexIsValid =
    recentProfileIndex !== null &&
    recentProfileIndex >= 0 &&
    recentProfileIndex < profiles.length;

  return recentIndexIsValid ? recentProfileIndex : 0;
}

async function restoreWorkspace(profileIndex: number): Promise<void> {
  const projectsEnabled = useConfigStore.getState().features.projects;
  if (!projectsEnabled) {
    await selectResolvedProject();
    useUIStore.getState().setSidebarVisible(true);
    focusVisiblePane("modules");
    return;
  }

  const profile = useConfigStore.getState().profiles[profileIndex];
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
  let resolved = tasks.projects.find(
    (project) => project.identifier === "CODING",
  );

  if (!resolved) {
    try {
      resolved = await tasks.createProject({
        name: "coding",
        slug: "CODING",
      });
    } catch {
      // A concurrent bootstrap may have resolved the project first. Refresh
      // once and use that authoritative row instead of duplicating resolution
      // policy in project-scoped code paths.
      await tasks.loadProjects();
      resolved = useTasksStore
        .getState()
        .projects.find((project) => project.identifier === "CODING");
      if (!resolved) throw new Error("The resolved CODING project is unavailable.");
    }
  }

  await useTasksStore.getState().selectProject(resolved.id);
}

function focusVisiblePane(preferredPane: FocusedPane): void {
  const { sidebarVisible, setFocusedPane } = useUIStore.getState();
  const projectIsSelected = useTasksStore.getState().selectedProjectId !== null;
  const visiblePanes = visiblePaneOrder(
    sidebarVisible,
    projectIsSelected,
    useConfigStore.getState().features.projects,
  );

  setFocusedPane(
    visiblePanes.includes(preferredPane) ? preferredPane : "tasks",
  );
}
