import { create } from "zustand";
export type OnboardingTourStep =
  | "inactive"
  | "module-create"
  | "story-create"
  | "handoff";

interface OnboardingTourState {
  step: OnboardingTourStep;
  projectId: string | null;
  moduleId: string | null;
  storyId: string | null;
  start: (projectId: string) => void;
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

/** Run-local only by design: a refresh never resumes a half-finished tour. */
export const useOnboardingTourStore = create<OnboardingTourState>((set) => ({
  ...INACTIVE,
  start: (projectId) =>
    set({ ...INACTIVE, step: "module-create", projectId }),
  moduleCreated: (moduleId) => set({ step: "story-create", moduleId }),
  storyCreated: (storyId) =>
    set((state) =>
      state.step === "story-create"
        ? { step: "handoff", storyId }
        : state,
    ),
  reset: () => set(INACTIVE),
}));
