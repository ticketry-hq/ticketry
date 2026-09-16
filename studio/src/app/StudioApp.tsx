import { BootstrapGate } from "./startup/BootstrapGate";
import { ServiceHealthGate } from "./startup/ServiceHealthGate";
import { OnboardingGate } from "./onboarding/OnboardingGate";
import { StudioShell } from "./shell/StudioShell";

export default function StudioApp() {
  // The bootstrap gate resolves and auto-selects the single implicit owned
  // profile (#581) before the app shell mounts. There is no profile picker:
  // during the brief zero-profile window it shows a connecting/retry state.
  return (
    <ServiceHealthGate>
      <BootstrapGate>
        <OnboardingGate>
          <StudioShell />
        </OnboardingGate>
      </BootstrapGate>
    </ServiceHealthGate>
  );
}
