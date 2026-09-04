import { TEMP_TASK_ID } from "../../../../features/agents/types";
import { scratchBucketId } from "../../../../features/agents/terminal";
import { PaneShell } from "../../PaneShell";
import { useStudioStore } from "../../../../features/projects";
import { useClientStore } from "../../../../state/clientStore";
import { useCachedStates } from "../../../../features/projects";
import type { WorkspaceLauncherContext } from "./SelectedTicketContent";
import { SelectedTicketDetails } from "./details/SelectedTicketDetails";
import { SelectedTicketContent } from "./SelectedTicketContent";
import {
  useSelectedInstantRunId,
} from "../tasks/internal/instantRunTicketNavigation";
import { StateConfigurationPanel } from "../../../../features/workflows";

/** Adapts Studio selection state to the selected-ticket workspace. */
export function SelectedTicket() {
  const selectedTaskId = useClientStore((s) => s.selectedTaskId);
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const workspaceSelection = useClientStore((s) => s.workspaceSelection);
  const conversationRunId = useSelectedInstantRunId();
  const states = useCachedStates(selectedProjectId);
  const dismissStateConfiguration = useClientStore(
    (s) => s.dismissStateConfiguration,
  );
  const bucket =
    selectedTaskId === TEMP_TASK_ID
      ? scratchBucketId(selectedModuleId ?? "")
      : selectedTaskId;
  const launchContext: WorkspaceLauncherContext | null =
    selectedTaskId && selectedProjectId && selectedTaskId !== TEMP_TASK_ID
      ? {
          kind: "task",
          taskId: selectedTaskId,
          projectId: selectedProjectId,
          moduleId: selectedModuleId,
        }
      : null;
  const configuredState =
    workspaceSelection.kind === "state-configuration" &&
    workspaceSelection.projectId === selectedProjectId
      ? states.find((state) => state.id === workspaceSelection.stateId) ?? null
      : null;

  return (
    <PaneShell pane="details-or-terminal">
      <div className="relative h-full min-h-0">
        <SelectedTicketContent
          bucket={bucket}
          projectId={selectedProjectId}
          moduleId={selectedModuleId}
          owner="studio"
          details={<SelectedTicketDetails />}
          launchContext={launchContext}
          conversationRunId={conversationRunId}
        />
        {configuredState ? (
          <StateConfigurationPanel
            state={configuredState}
            onClose={dismissStateConfiguration}
          />
        ) : null}
      </div>
    </PaneShell>
  );
}
