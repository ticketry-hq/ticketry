import { resolveDefaultProject } from "../../features/studio/lib/defaultProject";
import { useStudioStore } from "../../features/projects";
import { useOnboardingTourStore } from "./onboardingTourStore";
import { OnboardingProviders } from "./OnboardingProviders";

/**
 * The first-run welcome: activate providers, then open the installation
 * project. There is one project, so nobody is asked to name or choose one.
 */
export default function OnboardingWelcome() {
  const startTour = useOnboardingTourStore((state) => state.start);

  const continueFromProviders = async () => {
    let projectId = useStudioStore.getState().selectedProjectId;
    if (!projectId) {
      const project = await resolveDefaultProject();
      await useStudioStore.getState().selectProject(project.id);
      projectId = project.id;
    }
    if (projectId) startTour(projectId);
  };

  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-y-auto bg-pane-bg px-6 py-8"
      data-testid="onboarding-welcome"
    >
      <main className="w-full max-w-xl border border-pane-border bg-pane-panel p-8 shadow-xl">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-focus-accent">
          Welcome to WorkTracker
        </div>

        <OnboardingProviders
          continueLabel="Get started"
          onContinue={continueFromProviders}
        />
      </main>
    </div>
  );
}
