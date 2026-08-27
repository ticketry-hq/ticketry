import { useCallback, useEffect } from "react";
import { statusStreamFeed } from "../../features/agents/status/stream/statusStreamFeed";
import {
  startStallDeadlines,
  stopStallDeadlines,
} from "../../features/agents/status";
import { useStudioStore } from "../../features/projects";
import { useClientStore } from "../../state/clientStore";
import OnboardingTour from "../onboarding/OnboardingTour";
import { useGlobalKeymap } from "../navigation/useGlobalKeymap";
import { StudioFooter } from "./StudioFooter";
import { StudioLayout } from "./StudioLayout";
import { useStoriesTree } from "../../features/work-items";
import { statusStreamTransport } from "../../runtime";

export function StudioShell() {
  const { rows } = useStoriesTree();
  const selectedProjectId = useStudioStore((state) => state.selectedProjectId);
  const selectTask = useClientStore((state) => state.selectTask);
  const selectOnboardingStory = useCallback(
    (storyId: string) => void selectTask(storyId),
    [selectTask],
  );

  useGlobalKeymap(rows);

  useEffect(() => {
    if (!selectedProjectId) return;
    // The durable GraphQL subscription is the only status authority. Desktop
    // uses Tauri IPC; browser development streams it from the Rust adapter.
    const createProxy = statusStreamTransport();
    if (!createProxy) return;
    statusStreamFeed.start(selectedProjectId, { createProxy });
    startStallDeadlines();
    return () => {
      statusStreamFeed.stop();
      stopStallDeadlines();
    };
  }, [selectedProjectId]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="min-h-0 flex-1">
        <StudioLayout />
      </div>
      <StudioFooter />
      <OnboardingTour onSelectStory={selectOnboardingStory} />
    </div>
  );
}
