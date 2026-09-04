import { useCallback, useEffect } from "react";
import { useStudioStore } from "../../features/projects";
import { useClientStore } from "../../state/clientStore";
import OnboardingTour from "../onboarding/OnboardingTour";
import { useGlobalKeymap } from "../navigation/useGlobalKeymap";
import { startAgentStatusServices } from "../startup/startAgentStatusServices";
import { StudioFooter } from "./StudioFooter";
import { StudioLayout } from "./StudioLayout";
import { useStoriesTree } from "../../features/work-items";
import { statusStreamTransport } from "../../runtime";
import { ProjectRunTerminalTabBridge } from "./ProjectRunTerminalTabBridge";

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
    return startAgentStatusServices(selectedProjectId, createProxy);
  }, [selectedProjectId]);

  return (
    <div className="flex h-full w-full flex-col">
      <ProjectRunTerminalTabBridge />
      <div className="min-h-0 flex-1">
        <StudioLayout />
      </div>
      <StudioFooter />
      <OnboardingTour onSelectStory={selectOnboardingStory} />
    </div>
  );
}
