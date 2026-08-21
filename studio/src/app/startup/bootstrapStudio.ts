import { loadModuleLinks } from "../../features/module-links";
import { loadProjects } from "../../features/projects";
import { useStudioStore } from "../../features/projects/store";
import { resolveDefaultProject } from "../../features/studio/lib/defaultProject";
import {
  useClientStore,
  visiblePaneOrder,
  type FocusedPane,
} from "../../state/clientStore";
import { loadKeybindingOverrides } from "../navigation/keymapSettings";
import { loadProjectOnboardingState } from "../onboarding/onboardingStore";
import { DEFAULT_SIDEBAR_PANE_COMPOSITION } from "../shell/layout/layoutMath";

export type BootstrapOutcome = "provisioning" | "unavailable" | "ready";

export async function bootstrapStudio(): Promise<BootstrapOutcome> {
  try {
    await Promise.all([
      loadProjects(),
      loadModuleLinks(),
      loadKeybindingOverrides(),
      // Never rejects: onboarding owns its fallback so a transient read does
      // not make an otherwise usable Studio bootstrap unavailable.
      loadProjectOnboardingState(),
    ]);

    const project = await resolveDefaultProject();
    await useStudioStore.getState().selectProject(project.id);
    focusVisiblePane("modules");
    return "ready";
  } catch (error) {
    console.warn("[BootstrapGate] default project resolve failed", error);
    return error instanceof TypeError ? "unavailable" : "provisioning";
  }
}

function focusVisiblePane(preferredPane: FocusedPane): void {
  const { sidebarVisible, setFocusedPane } = useClientStore.getState();
  const projectIsSelected = useStudioStore.getState().selectedProjectId !== null;
  const visiblePanes = visiblePaneOrder(
    sidebarVisible,
    projectIsSelected,
    DEFAULT_SIDEBAR_PANE_COMPOSITION,
  );

  setFocusedPane(
    visiblePanes.includes(preferredPane) ? preferredPane : "tasks",
  );
}
