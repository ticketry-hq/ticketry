import { useEffect, useState } from "react";
import { openStoryWorkflowGuide } from "../modal/openStoryWorkflowGuide";
import { apiErrorMessage } from "../../shared/api/errors";
import { useClientStore } from "../../state/clientStore";
import { useModalStore } from "../modal/modalStore";
import CoachMark from "./CoachMark";
import { StoryHandoffGuidance } from "./StoryHandoffGuidance";
import { acknowledgeOnboarding } from "./onboardingStore";
import { useOnboardingTourStore } from "./onboardingTourStore";

interface Props {
  onSelectStory: (storyId: string) => void;
}

const buttonClass =
  "bg-focus-accent px-3 py-1.5 text-sm font-semibold text-pane-bg disabled:opacity-50";

export default function OnboardingTour({ onSelectStory }: Props) {
  const step = useOnboardingTourStore((state) => state.step);
  const storyId = useOnboardingTourStore((state) => state.storyId);
  const projectId = useOnboardingTourStore((state) => state.projectId);
  const reset = useOnboardingTourStore((state) => state.reset);
  const selectedTaskId = useClientStore((state) => state.selectedTaskId);
  const guideOpen = useModalStore(
    (state) => state.modalStack.at(-1)?.type === "story-workflow-guide",
  );
  const addModuleOpen = useModalStore(
    (state) => state.modalStack.at(-1)?.type === "add-module",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moduleGuide, setModuleGuide] = useState<"name" | "folder" | "done">(
    "name",
  );

  useEffect(() => {
    if (step === "handoff" && storyId) onSelectStory(storyId);
  }, [onSelectStory, step, storyId]);

  useEffect(() => {
    if (!addModuleOpen) setModuleGuide("name");
  }, [addModuleOpen]);

  if (step === "inactive") return null;

  const dismiss = async () => {
    if (busy || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      // The tour was started for one project, so its acknowledgement is bound
      // to that project rather than to whichever one resolves first later.
      await acknowledgeOnboarding(projectId);
      reset();
    } catch (cause) {
      setError(apiErrorMessage(cause));
      setBusy(false);
    }
  };

  const skipTour = (
    <div className="mt-4 flex items-center justify-between gap-3">
      <button
        type="button"
        data-testid="onboarding-skip-tour"
        disabled={busy}
        onClick={() => void dismiss()}
        className="px-2 py-1.5 text-sm font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
      >
        {busy ? "Working…" : "Skip tour"}
      </button>
    </div>
  );

  const errorNode = error ? (
    <p data-testid="onboarding-step-error" className="mt-3 text-sm text-lifecycle-danger">
      {error}
    </p>
  ) : null;

  if (step === "module-create") {
    if (addModuleOpen && moduleGuide === "name") {
      return (
        <CoachMark
          anchor="module-name"
          title="Name the module"
          description="This is the label for a set of related stories. Use a name that describes the work you want to track; it does not have to match the folder or repository name."
          focusDialog={false}
        >
          <button
            type="button"
            data-testid="onboarding-module-name-next"
            className={buttonClass}
            onClick={() => setModuleGuide("folder")}
          >
            Next
          </button>
        </CoachMark>
      );
    }
    if (addModuleOpen && moduleGuide === "folder") {
      return (
        <CoachMark
          anchor="module-folder"
          title="Choose where work runs"
          description="This is the project's working directory (CWD): the folder containing the code this module works on. Ticketry opens terminals and starts coding agents here. Multiple modules can share the same folder."
          focusDialog={false}
        >
          <button
            type="button"
            data-testid="onboarding-module-folder-done"
            className={buttonClass}
            onClick={() => setModuleGuide("done")}
          >
            Got it
          </button>
        </CoachMark>
      );
    }
    if (addModuleOpen) return null;
    return (
      <CoachMark
        anchor="module-add"
        title="Add your first module"
        description="A module groups related stories and sets where their work runs. Select + Add Module to choose its working directory (CWD). Multiple modules can use the same folder."
        focusDialog={false}
      >
        {errorNode}
      </CoachMark>
    );
  }

  if (step === "story-create") {
    return (
      <CoachMark
        anchor="story-add"
        title="Create your first story"
        description="A Story describes a change you want to make and why it matters. For example: Add a search box so people can find saved notes. Type into the real idea field and press Enter. This is where you will capture Stories every day."
        focusDialog={false}
      >
        {errorNode}
        {skipTour}
      </CoachMark>
    );
  }

  if (guideOpen) return null;

  return (
    <CoachMark
      anchor="workspace"
      portal
      title="Your first story is ready"
      description="The Story is selected in your workspace. You can continue working on it here."
    >
      {storyId && <StoryHandoffGuidance storyId={storyId} />}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="onboarding-story-workflow-guide"
          className="border border-pane-border px-3 py-1.5 text-sm font-semibold text-text-primary hover:bg-pane-title"
          onClick={() => {
            if (!storyId || busy || useModalStore.getState().modalStack.length) return;
            if (selectedTaskId !== storyId) onSelectStory(storyId);
            openStoryWorkflowGuide(storyId, "handoff");
          }}
        >
          Story workflow guide
        </button>
        <button
          data-testid="onboarding-finish"
          className={buttonClass}
          disabled={busy}
          onClick={() => void dismiss()}
        >
          {busy ? "Finishing…" : "Finish tour"}
        </button>
      </div>
      {errorNode}
    </CoachMark>
  );
}
