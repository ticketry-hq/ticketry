import { create } from "zustand";
import * as api from "../../shared/api/client";

interface OnboardingState {
  onboardingRequired: boolean;
  loadWorkspaceState: () => Promise<void>;
  acknowledgeOnboarding: () => Promise<void>;
}

/**
 * Owns whether first-run onboarding is still unacknowledged for this
 * workspace. Loaded during the bootstrap fan-out; the run-local tour store
 * next door owns tour progress, not this durable flag.
 */
export const useOnboardingStore = create<OnboardingState>((set) => ({
  onboardingRequired: false,

  // Deliberately never rejects: a flaky workspace endpoint must not reach the
  // bootstrap error path and strand an existing user on a retry screen. The
  // failure mode is a missing welcome, not a blocked launch.
  async loadWorkspaceState() {
    try {
      const workspace = await api.getWorkspace();
      set({ onboardingRequired: workspace.onboarding_required });
    } catch (error) {
      console.warn("[onboarding] workspace state load failed", error);
      set({ onboardingRequired: false });
    }
  },

  async acknowledgeOnboarding() {
    const workspace = await api.acknowledgeOnboarding();
    set({ onboardingRequired: workspace.onboarding_required });
  },
}));
