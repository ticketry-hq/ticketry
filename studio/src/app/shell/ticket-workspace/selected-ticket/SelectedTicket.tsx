import { TEMP_TASK_ID } from "../../../../features/agents/types";
import { scratchBucketId } from "../../../../features/agents/terminal";
import { PaneShell } from "../../PaneShell";
import { useStudioStore } from "../../../../features/projects/store";
import { useClientStore } from "../../../../state/clientStore";
import { useCachedStates } from "../../../../shared/query/stateCatalog";
import { useWorkItem } from "../../../../features/work-items";
import type { WorkspaceLauncherContext } from "./SelectedTicketContent";
import { SelectedTicketDetails } from "./details/SelectedTicketDetails";
import { SelectedTicketContent } from "./SelectedTicketContent";
import {
  startInstantChangeFlow,
  startPlanFlow,
} from "../../../../features/studio/modals/PlanFeature";
import { StateConfigurationPanel } from "../../../../features/workflows/StateConfigurationPanel";

/** Adapts Studio selection state to the selected-ticket workspace. */
export function SelectedTicket() {
  const selectedTaskId = useClientStore((s) => s.selectedTaskId);
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const workspaceSelection = useClientStore((s) => s.workspaceSelection);
  const states = useCachedStates(selectedProjectId);
  const dismissStateConfiguration = useClientStore(
    (s) => s.dismissStateConfiguration,
  );
  const { data: task } = useWorkItem(
    selectedTaskId && selectedTaskId !== TEMP_TASK_ID ? selectedTaskId : null,
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
          taskKey: task?.id ?? selectedTaskId,
          taskName: task?.name ?? "",
        }
      : selectedTaskId === TEMP_TASK_ID && selectedProjectId && selectedModuleId
        ? {
            kind: "scratch",
            onChooseMode: (mode) => {
              if (mode === "plan") startPlanFlow();
              else startInstantChangeFlow();
            },
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
          parentId={task?.parent_id ?? null}
          owner="studio"
          details={<SelectedTicketDetails />}
          launchContext={launchContext}
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
