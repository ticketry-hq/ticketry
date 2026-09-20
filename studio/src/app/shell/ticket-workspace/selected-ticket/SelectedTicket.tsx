import { TEMP_TASK_ID } from "../../../../features/agents/types";
import {
  scratchBucketId,
  useInstantRunTicketTitle,
  useTerminalStore,
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
} from "../tasks/internal/instantRunTicketNavigation";
import { StateConfigurationPanel } from "../../../../features/workflows";
import { ConversationConfigurationPanel } from "../../../../features/settings";
import { recordSelectionProfilePoint } from "../../../../shared/utilities/selectionProfile";
import { selectedRunSession } from "../../../../features/agents/actions/selectedAgentRun";

/** Adapts Studio selection state to the selected-ticket workspace. */
export function SelectedTicket({ active = true }: { active?: boolean }) {
  recordSelectionProfilePoint("selected-ticket-render");
  const selectedTaskId = useClientStore((s) => s.selectedTaskId);
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const workspaceSelection = useClientStore((s) => s.workspaceSelection);
  const conversationRunId = useSelectedInstantRunId();
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
  const closeConversationConfiguration = () => {
    dismissConversationConfiguration();
    requestAnimationFrame(() => {
      const session = selectedRunSession();
      if (session) useTerminalStore.getState().focusSession(session.sessionId);
    });
  };
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
        <SelectedTicketContent
          bucket={bucket}
          projectId={selectedProjectId}
          moduleId={selectedModuleId}
          owner="studio"
          workspaceActive={active}
          details={<SelectedTicketDetails />}
          launchContext={launchContext}
          conversationRunId={conversationRunId}
          conversationTitle={conversationTitle}
        />
        {configuredState ? (
          <StateConfigurationPanel
            state={configuredState}
            onClose={dismissStateConfiguration}
          />
        ) : workspaceSelection.kind === "conversation-configuration" &&
          workspaceSelection.projectId === selectedProjectId &&
          workspaceSelection.moduleId === selectedModuleId ? (
          <ConversationConfigurationPanel
            onClose={closeConversationConfiguration}
          />
        ) : null}
      </div>
    </PaneShell>
  );
}
