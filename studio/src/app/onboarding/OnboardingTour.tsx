import { FormEvent, useEffect, useRef, useState } from "react";
import { apiErrorMessage } from "../../shared/api/client";
import { useTasksStore } from "../../features/studio/stores/tasksStore";
import CoachMark from "./CoachMark";
import { useOnboardingStore } from "./onboardingStore";
import { useOnboardingTourStore } from "./onboardingTourStore";

interface Props {
  onSelectStory: (storyId: string) => void;
}

const buttonClass =
  "rounded-md bg-focus-accent px-3 py-1.5 text-sm font-semibold text-pane-bg disabled:opacity-50";

export default function OnboardingTour({ onSelectStory }: Props) {
  const step = useOnboardingTourStore((state) => state.step);
  const projectId = useOnboardingTourStore((state) => state.projectId);
  const storyId = useOnboardingTourStore((state) => state.storyId);
  const showModuleCreate = useOnboardingTourStore((state) => state.showModuleCreate);
  const moduleCreated = useOnboardingTourStore((state) => state.moduleCreated);
  const reset = useOnboardingTourStore((state) => state.reset);
  const createModule = useTasksStore((state) => state.createModule);
  const acknowledge = useOnboardingStore((state) => state.acknowledgeOnboarding);
  const [moduleName, setModuleName] = useState("General");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const moduleInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "handoff" && storyId) onSelectStory(storyId);
  }, [onSelectStory, step, storyId]);

  if (step === "inactive") return null;

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await acknowledge();
      reset();
    } catch (cause) {
      setError(apiErrorMessage(cause));
      setBusy(false);
    }
  };

  const createGuidedModule = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !moduleName.trim() || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      await createModule(projectId, moduleName.trim());
      const selectedModuleId = useTasksStore.getState().selectedModuleId;
      if (!selectedModuleId) {
        throw new Error("The new module could not be selected.");
      }
      moduleCreated(selectedModuleId);
      setBusy(false);
    } catch (cause) {
      setError(apiErrorMessage(cause));
      setBusy(false);
      requestAnimationFrame(() => moduleInput.current?.focus());
    }
  };

  const footer = (
    <div className="mt-4 flex items-center justify-between gap-3">
      <button
        type="button"
        data-testid="onboarding-skip-tour"
        disabled={busy}
        onClick={() => void dismiss()}
        className="rounded-md px-2 py-1.5 text-sm font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
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

  if (step === "projects-pane") {
    return (
      <CoachMark
        anchor="project-add"
        title="Your projects"
        description="Projects live here. Use Add Project whenever you need another one."
      >
        <button data-testid="onboarding-continue" className={buttonClass} onClick={showModuleCreate}>
          Continue
        </button>
        {errorNode}
        {footer}
      </CoachMark>
    );
  }

  if (step === "module-create") {
    return (
      <CoachMark
        anchor="module-add"
        title="Create your first module"
        description="Modules group related stories. The name is editable."
        focusDialog={false}
      >
        <form onSubmit={(event) => void createGuidedModule(event)}>
          <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
            Module name
            <input
              ref={moduleInput}
              autoFocus
              value={moduleName}
              onChange={(event) => setModuleName(event.target.value)}
              data-testid="onboarding-module-name"
              className="mt-2 block w-full rounded-md border border-pane-border bg-pane-bg px-3 py-2 text-base font-normal normal-case tracking-normal text-text-primary outline-none focus:border-focus-accent"
            />
          </label>
          {errorNode}
          <button
            type="submit"
            data-testid="onboarding-create-module"
            disabled={busy || !moduleName.trim()}
            className={`${buttonClass} mt-4`}
          >
            {busy ? "Creating…" : "Create module"}
          </button>
        </form>
        {footer}
      </CoachMark>
    );
  }

  if (step === "story-create") {
    return (
      <CoachMark
        anchor="story-add"
        title="Create your first story"
        description="Type into the real idea field and press Enter. This is where you will capture Stories every day."
        focusDialog={false}
      >
        {errorNode}
        {footer}
      </CoachMark>
    );
  }

  return (
    <CoachMark
      anchor="workspace"
      title="Your first story is ready"
      description="The story is selected in the normal backlog workspace."
    >
      <button
        data-testid="onboarding-finish"
        className={buttonClass}
        disabled={busy}
        onClick={() => void dismiss()}
      >
        {busy ? "Finishing…" : "Finish tour"}
      </button>
      {errorNode}
      {footer}
    </CoachMark>
  );
}
