import { TEMP_TASK_ID } from "../../../agents/types";
import { scratchBucketId } from "../../../agents/terminal";
import { PaneShell } from "../../components/PaneShell";
import { useConfig } from "../../stores/configStore";
import { useTasksStore } from "../../stores/tasksStore";
import type {
  WorkspaceLauncherContext,
} from "../../../work-items/issue-detail";
import { DetailsTab } from "./tabs/DetailsTab";
import { WorkspacePane } from "../../../work-items/issue-detail";
import {
  startInstantChangeFlow,
  startPlanFlow,
} from "../../modals/PlanFeature";
import { StateConfigurationPanel } from "../../../workflows/StateConfigurationPanel";

/** Adapts the Studio selection stores to the shared workspace pane. */
export function TicketWorkspace() {
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId);
  const selectedProjectId = useTasksStore((s) => s.selectedProjectId);
  const selectedModuleId = useTasksStore((s) => s.selectedModuleId);
  const workspaceSelection = useTasksStore((s) => s.workspaceSelection);
  const states = useTasksStore((s) => s.states);
  const dismissStateConfiguration = useTasksStore(
    (s) => s.dismissStateConfiguration,
  );
  const tasks = useTasksStore((s) => s.tasks);
  const { profiles, recentProfileIndex } = useConfig();
  const task = tasks.find((candidate) => candidate.id === selectedTaskId);
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
        <WorkspacePane
          bucket={bucket}
          projectId={selectedProjectId}
          moduleId={selectedModuleId}
          ticketKey={task?.key}
          owner="studio"
          details={<DetailsTab />}
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
