import { createApolloStore } from "../../shared/apollo/localState";
import {
  getConfigSnapshot,
  isSidebarEnabled,
} from "../../features/studio/stores/configStore";

export type OnboardingTourStep =
  | "inactive"
  | "projects-pane"
  | "module-create"
  | "story-create"
  | "handoff";

interface OnboardingTourState {
  step: OnboardingTourStep;
  projectId: string | null;
  moduleId: string | null;
  storyId: string | null;
  start: (projectId: string) => void;
  showModuleCreate: () => void;
  moduleCreated: (moduleId: string) => void;
  storyCreated: (storyId: string) => void;
  reset: () => void;
}

const INACTIVE = {
  step: "inactive" as const,
  projectId: null,
  moduleId: null,
  storyId: null,
};

function openingStep(): OnboardingTourStep {
  const config = getConfigSnapshot();
  return isSidebarEnabled(config) && config.features.projects
    ? "projects-pane"
    : "module-create";
}

/** Run-local only by design: a refresh never resumes a half-finished tour. */
export const useOnboardingTourStore = createApolloStore<OnboardingTourState>("onboarding-tour", (set) => ({
  ...INACTIVE,
  start: (projectId) =>
    set({ ...INACTIVE, step: openingStep(), projectId }),
  showModuleCreate: () => set({ step: "module-create" }),
  moduleCreated: (moduleId) => set({ step: "story-create", moduleId }),
  storyCreated: (storyId) =>
    set((state) =>
      state.step === "story-create"
        ? { step: "handoff", storyId }
        : state,
    ),
  reset: () => set(INACTIVE),
}));
