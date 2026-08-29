import {
  getOnboardingRequiredSnapshot,
  loadOnboardingState,
} from "../onboarding/onboardingStore";
import { loadModuleLinks } from "../../features/module-links";
import { loadProjects, useStudioStore } from "../../features/projects";
import { resolveDefaultProject } from "../../features/studio/lib/defaultProject";
import { loadKeybindingOverrides } from "../navigation/keymapSettings";
import {
  useClientStore,
  visiblePaneOrder,
  type FocusedPane,
} from "../../state/clientStore";

export type BootstrapOutcome = "provisioning" | "unavailable" | "ready";

/**
 * Open Studio on the installation project.
 *
 * There is one project, so startup selects it rather than asking. Nothing here
 * consults a profile file, a profile index, a feature flag, or a recent-project
 * list: the only remembered navigation is the one module this webview was last
 * working in, and it is only honoured once its Module Link is in the cache.
 */
export async function bootstrapStudio(): Promise<BootstrapOutcome> {
  try {
    await loadBootstrapData();
    await restoreWorkspace();
    return "ready";
  } catch (error) {
    console.warn("[BootstrapGate] installation project resolve failed", error);
    return error instanceof TypeError ? "unavailable" : "provisioning";
  }
}

async function loadBootstrapData(): Promise<void> {
  await Promise.all([
    // The project list has to be in the cache before the installation project
    // can be resolved from it.
    loadProjects(),
    // Module folders gate module selection and every launch, so the links are
    // read before the restored workspace asks for one.
    loadModuleLinks(),
    loadKeybindingOverrides(),
    // Never rejects: the store swallows its own failure so a flaky project
    // endpoint cannot flip the bootstrap outcome away from "ready".
    loadOnboardingState(),
  ]);
}

async function restoreWorkspace(): Promise<void> {
  const project = await resolveDefaultProject();
  await useStudioStore.getState().selectProject(project.id);

  // A pending first run may be replaying over webview-local preferences from
  // an established workspace. Leave that preference intact for the tour to
  // capture before it temporarily reveals its anchors.
  if (!getOnboardingRequiredSnapshot()) {
    useClientStore.getState().setSidebarVisible(true);
  }
  // Selecting the project restores the remembered module when it is still
  // present and linked, so the pane to open is whichever one now has content.
  const moduleRestored = useClientStore.getState().selectedModuleId !== null;
  focusVisiblePane(moduleRestored ? "tasks" : "modules");
}

function focusVisiblePane(preferredPane: FocusedPane): void {
  const { sidebarVisible, setFocusedPane } = useClientStore.getState();
  const projectIsSelected = useStudioStore.getState().selectedProjectId !== null;
  const visiblePanes = visiblePaneOrder(sidebarVisible, projectIsSelected);

  setFocusedPane(
    visiblePanes.includes(preferredPane) ? preferredPane : "tasks",
  );
}
