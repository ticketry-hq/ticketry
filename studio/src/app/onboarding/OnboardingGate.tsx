import type { ReactNode } from "react";
import { useOnboardingStore } from "./onboardingStore";
import { useOnboardingTourStore } from "./onboardingTourStore";
import OnboardingWelcome from "./OnboardingWelcome";

/**
 * Substitutes the onboarding surface for the app shell while first-run setup
 * is unacknowledged — the same full-screen-replacement seam the service-health
 * and bootstrap gates establish.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const onboardingRequired = useOnboardingStore(
    (state) => state.onboardingRequired,
  );
  const tourStep = useOnboardingTourStore((state) => state.step);

  if (!onboardingRequired || tourStep !== "inactive") return <>{children}</>;

  return <OnboardingWelcome />;
}
