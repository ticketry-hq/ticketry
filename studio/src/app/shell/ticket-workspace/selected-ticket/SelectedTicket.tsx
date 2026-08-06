import { TEMP_TASK_ID } from "../../../../features/agents/types";
import { scratchBucketId } from "../../../../features/agents/terminal";
import { PaneShell } from "../../PaneShell";
import { useConfig } from "../../../../features/studio/stores/configStore";
import {
  useTaskStates,
  useTasksStore,
} from "../../../../features/studio/stores/tasksStore";
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
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId);
  const selectedProjectId = useTasksStore((s) => s.selectedProjectId);
  const selectedModuleId = useTasksStore((s) => s.selectedModuleId);
  const workspaceSelection = useTasksStore((s) => s.workspaceSelection);
  const states = useTaskStates();
  const dismissStateConfiguration = useTasksStore(
    (s) => s.dismissStateConfiguration,
  );
  const { profiles, recentProfileIndex } = useConfig();
  const { data: task } = useWorkItem(
    selectedTaskId && selectedTaskId !== TEMP_TASK_ID ? selectedTaskId : null,
  );
  const profile = recentProfileIndex === null ? null : profiles[recentProfileIndex] ?? null;
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
          ticketSeq: task?.sequence_id ?? null,
          profileReady: !!profile,
          profile,
        }
      : selectedTaskId === TEMP_TASK_ID && selectedProjectId && selectedModuleId
        ? {
            kind: "scratch",
            profileReady: !!profile,
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
          ticketKey={task?.key}
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
