import { useRef } from "react";
import { TEMP_TASK_ID } from "../../../../features/agents/types";
import {
  scratchBucketId,
  useInstantRunTicketTitle,
} from "../../../../features/agents/terminal";
import { PaneShell } from "../../PaneShell";
import { useStudioStore } from "../../../../features/projects";
import { useClientStore } from "../../../../state/clientStore";
import { useCachedStates } from "../../../../features/projects";
import type { WorkspaceLauncherContext } from "./SelectedTicketContent";
import { SelectedTicketDetails } from "./details/SelectedTicketDetails";
import { SelectedTicketContent } from "./SelectedTicketContent";
import {
  useSelectedInstantRunId,
  useSelectedPlanningRowId,
} from "../tasks/internal/instantRunTicketNavigation";
import { StateConfigurationPanel } from "../../../../features/workflows";
import { ConversationConfigurationPanel } from "../../../../features/settings";
import { recordSelectionProfilePoint } from "../../../../shared/utilities/selectionProfile";

/** Adapts Studio selection state to the selected-ticket workspace. */
export function SelectedTicket({ active = true }: { active?: boolean }) {
  recordSelectionProfilePoint("selected-ticket-render");
  const currentTaskId = useClientStore((s) => s.selectedTaskId);
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const currentModuleId = useClientStore((s) => s.selectedModuleId);
  // Only retain presentation identities, never record or application-state
  // copies. Module restoration can briefly have no selected Story; that
  // empty authoritative selection must not tear down dormant native viewers.
  const dormantContext = useRef<{ projectId: string; moduleId: string; taskId: string | null } | null>(null);
  if (selectedProjectId && currentModuleId && (currentTaskId || !dormantContext.current)) {
    dormantContext.current = { projectId: selectedProjectId, moduleId: currentModuleId, taskId: currentTaskId };
  } else if (dormantContext.current?.projectId !== selectedProjectId) {
    dormantContext.current = null;
  }
  const dormant = !currentTaskId ? dormantContext.current : null;
  const selectedModuleId = dormant?.moduleId ?? currentModuleId;
  const selectedTaskId = currentTaskId ?? dormant?.taskId ?? null;
  const workspaceSelection = useClientStore((s) => s.workspaceSelection);
  const conversationRunId = useSelectedInstantRunId();
  // The New conversation row is an action, not a workspace: keep its scratch
  // tabs mounted (terminals stay attached) but show nothing.
  const newConversationRowSelected =
    useSelectedPlanningRowId() === TEMP_TASK_ID;
  const conversationTitle = useInstantRunTicketTitle(
    selectedProjectId,
    selectedModuleId,
    conversationRunId,
  );
  const states = useCachedStates(selectedProjectId);
  const dismissStateConfiguration = useClientStore(
    (s) => s.dismissStateConfiguration,
  );
  const dismissConversationConfiguration = useClientStore(
    (s) => s.dismissConversationConfiguration,
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
    <PaneShell
      pane="details-or-terminal"
      title={conversationRunId ? conversationTitle ?? undefined : undefined}
      titleCasing="preserve"
    >
      <div className="relative h-full min-h-0">
        <div className="h-full" hidden={newConversationRowSelected || !currentTaskId}>
          <SelectedTicketContent
            bucket={bucket}
            projectId={selectedProjectId}
            moduleId={selectedModuleId}
            owner="studio"
            workspaceActive={active && !!currentTaskId && !newConversationRowSelected && workspaceSelection.kind === "task"}
            details={<SelectedTicketDetails />}
            launchContext={launchContext}
            conversationRunId={conversationRunId}
            conversationTitle={conversationTitle}
          />
        </div>
        {configuredState ? (
          <StateConfigurationPanel
            state={configuredState}
            onClose={dismissStateConfiguration}
          />
        ) : workspaceSelection.kind === "conversation-configuration" &&
          workspaceSelection.projectId === selectedProjectId &&
          workspaceSelection.moduleId === selectedModuleId ? (
          <ConversationConfigurationPanel
            onClose={dismissConversationConfiguration}
          />
        ) : null}
      </div>
    </PaneShell>
  );
}
