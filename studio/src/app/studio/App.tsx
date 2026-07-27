import { useCallback, useEffect } from "react";
import { Layout } from "./layout/Layout";
import { Footer } from "./Footer";
import { BootstrapGate } from "./BootstrapGate";
import { useGlobalKeymap } from "../navigation/useGlobalKeymap";
import { useTaskTree } from "../../features/studio/pages/tasks/hooks/useTaskTree";
import { useTasksStore } from "../../features/studio/stores/tasksStore";
import { statusFeed } from "../../features/agents/status/statusFeed";
import { ServiceHealthGate } from "./ServiceHealthGate";
import { OnboardingGate } from "../onboarding/OnboardingGate";
import OnboardingTour from "../onboarding/OnboardingTour";

export default function StudioApp() {
  // The bootstrap gate resolves and auto-selects the single implicit owned
  // profile (#581) before the app shell mounts. There is no profile picker:
  // during the brief zero-profile window it shows a connecting/retry state.
  return (
    <ServiceHealthGate>
      <BootstrapGate>
        <OnboardingGate>
          <AppShell />
        </OnboardingGate>
      </BootstrapGate>
    </ServiceHealthGate>
  );
}

function AppShell() {
  const { rows } = useTaskTree();
  const selectedProjectId = useTasksStore((state) => state.selectedProjectId);
  const selectTask = useTasksStore((state) => state.selectTask);
  const selectOnboardingStory = useCallback(
    (storyId: string) => void selectTask(storyId),
    [selectTask],
  );
  useGlobalKeymap(rows);

  useEffect(() => {
    if (!selectedProjectId) return;
    statusFeed.start(selectedProjectId, {
      refreshSnapshotOnSocketOpen: true,
    });
    return () => statusFeed.stop();
  }, [selectedProjectId]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="min-h-0 flex-1">
        <Layout />
      </div>
      <Footer />
      <OnboardingTour onSelectStory={selectOnboardingStory} />
      {/* The host entry renders the one global ModalHost (CODIN-915). */}
    </div>
  );
}
