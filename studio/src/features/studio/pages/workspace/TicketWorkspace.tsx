import { TEMP_TASK_ID } from "../../../agents/types";
import { scratchBucketId } from "../../../agents/terminal";
import { PaneShell } from "../../components/PaneShell";
import { useConfigStore } from "../../stores/configStore";
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

/** Adapts the Studio selection stores to the shared workspace pane. */
export function TicketWorkspace() {
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId);
  const selectedProjectId = useTasksStore((s) => s.selectedProjectId);
  const selectedModuleId = useTasksStore((s) => s.selectedModuleId);
  const tasks = useTasksStore((s) => s.tasks);
  const recentProfileIndex = useConfigStore((s) => s.recentProfileIndex);
  const profiles = useConfigStore((s) => s.profiles);
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

  return (
    <PaneShell pane="details-or-terminal">
      <WorkspacePane
        bucket={bucket}
        projectId={selectedProjectId}
        moduleId={selectedModuleId}
        ticketKey={task?.key}
        owner="studio"
        details={<DetailsTab />}
        launchContext={launchContext}
      />
    </PaneShell>
  );
}
