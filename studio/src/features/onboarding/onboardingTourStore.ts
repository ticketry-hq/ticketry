import { createApolloStore } from "../../shared/apollo/localState";

export type OnboardingTourStep =
  | "inactive"
  | "module-create"
  | "module-ready"
  | "story-create"
  | "handoff";

interface OnboardingTourState {
  step: OnboardingTourStep;
  projectId: string | null;
  moduleId: string | null;
  storyId: string | null;
  start: (projectId: string) => void;
  /** Without a Story type the tour ends at `module-ready` instead of Story capture. */
  moduleCreated: (moduleId: string, storyCaptureAvailable: boolean) => void;
  storyCreated: (storyId: string) => void;
  reset: () => void;
}

const INACTIVE = {
  step: "inactive" as const,
  projectId: null,
  moduleId: null,
  storyId: null,
};

/** Run-local only by design: a refresh never resumes a half-finished tour. */
export const useOnboardingTourStore = createApolloStore<OnboardingTourState>("onboarding-tour", (set) => ({
  ...INACTIVE,
  start: (projectId) =>
    // One installation project: the tour opens on creating the first module.
    set({ ...INACTIVE, step: "module-create", projectId }),
  moduleCreated: (moduleId, storyCaptureAvailable) =>
    set({ step: storyCaptureAvailable ? "story-create" : "module-ready", moduleId }),
  storyCreated: (storyId) =>
    set((state) =>
      state.step === "story-create"
        ? { step: "handoff", storyId }
        : state,
    ),
  reset: () => set(INACTIVE),
}));
