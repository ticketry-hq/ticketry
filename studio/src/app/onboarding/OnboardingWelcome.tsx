import { resolveDefaultProject } from "../../features/studio/lib/defaultProject";
import { useStudioStore } from "../../features/projects";
import { useOnboardingTourStore } from "./onboardingTourStore";
import { OnboardingProviders } from "./OnboardingProviders";

/**
 * The first-run welcome introduces Ticketry, then offers optional provider
 * setup before opening the installation project.
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
          Welcome to Ticketry
        </div>
        <p className="mt-3 text-sm leading-6 text-text-secondary">
          Ticketry helps you turn ideas into planned work, run coding agents when you choose,
          and review their changes. Start by capturing a Story. You can plan without an agent provider.
        </p>

        <OnboardingProviders
          continueLabel="Get started"
          onContinue={continueFromProviders}
        />
      </main>
    </div>
  );
}
