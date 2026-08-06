import { useCallback, useEffect } from "react";
import { statusFeed } from "../../features/agents/status/statusFeed";
import { useTasksStore } from "../../features/studio/stores/tasksStore";
import OnboardingTour from "../onboarding/OnboardingTour";
import { useGlobalKeymap } from "../navigation/useGlobalKeymap";
import { StudioFooter } from "./StudioFooter";
import { StudioLayout } from "./StudioLayout";
import { useTaskTree } from "./ticket-workspace/tasks/hooks/useTaskTree";

export function StudioShell() {
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
        <StudioLayout />
      </div>
      <StudioFooter />
      <OnboardingTour onSelectStory={selectOnboardingStory} />
    </div>
  );
}
