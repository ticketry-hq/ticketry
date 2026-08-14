import { useCallback, useEffect } from "react";
import { statusFeed } from "../../features/agents/status/statusFeed";
import { useStudioStore } from "../../features/projects/store";
import { useClientStore } from "../../state/clientStore";
import OnboardingTour from "../onboarding/OnboardingTour";
import { useGlobalKeymap } from "../navigation/useGlobalKeymap";
import { StudioFooter } from "./StudioFooter";
import { StudioLayout } from "./StudioLayout";
import { useStoriesTree } from "./ticket-workspace/tasks/useStoriesTree";

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
    statusFeed.start(selectedProjectId, {
      refreshSnapshotOnSocketOpen: true,
    });
    return () => statusFeed.stop();
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
