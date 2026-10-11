import { preloadLiveRunStatus } from "../../features/agents/status/stream/liveRunPreload";
import { loadOnboardingState } from "../onboarding/onboardingStore";
import { loadModuleLinks } from "../../features/module-links";
import { loadProjects, useStudioStore } from "../../features/projects";
import { resolveDefaultProject } from "../../features/studio/lib/defaultProject";
import { loadKeybindingOverrides } from "../navigation/keymapSettings";
import { recordStartupStage } from "./startupTrace";
import {
  useClientStore,
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
    recordStartupStage("frontend-bootstrap-started");
    await loadBootstrapData();
    recordStartupStage("frontend-bootstrap-data-loaded");
    await restoreWorkspace();
    recordStartupStage("frontend-workspace-restored");
    return "ready";
  } catch (error) {
    recordStartupStage("frontend-bootstrap-failed");
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
  await Promise.all([
    useStudioStore.getState().selectProject(project.id),
    // Concurrent with the selection, so it costs no serial time: the point is
    // only that the live-run holding is filled before the shell first renders.
    preloadLiveRunStatus(project.id),
  ]);

  // Recovery stays reachable from the footer when no remembered module exists.
  useClientStore.getState().setEditViewZone("stories");
}
