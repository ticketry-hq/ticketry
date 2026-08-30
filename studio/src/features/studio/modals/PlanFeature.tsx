// PlanFeature is a small state-machine helper, not a literal modal. The `n`
// keymap handler uses `startPlanFlow` to compose ModuleFolder → PromptInput →
// AgentPicker.
import {
  beginTerminalCreate,
  hasInitialPrompt,
} from "../../agents/terminal/create/launchTerminalCreate";
import type {
  TerminalCreateFlow,
  TerminalCreateRequest,
} from "../../agents/terminal/create/types";
import { useModalStore } from "../../../app/modal/modalStore";
import { getModuleFolder } from "../../module-links";
import { TEMP_TASK_ID } from "../../agents/types";
import { launchInstantConversation } from "../../agents/terminal";
import { useStudioStore } from "../../projects";
import { useClientStore } from "../../../state/clientStore";
import { getWorkItemSnapshot } from "../../work-items";

function selectScratchWorkspace(): void {
  useClientStore.getState().selectTask(TEMP_TASK_ID);
}

// The Studio adapter for the shared terminal-create launcher (CODIN-839): it
// wires the launcher's abstract steps onto Studio's existing modal chain. The
// launcher owns the sequencing; this only says how each step is presented.
function studioPlanFlow(): TerminalCreateFlow {
  const modal = useModalStore.getState();
  // The agent-picker payload merges any supplied prompt (empty in Studio's `n`
  // path, where PromptInput collects it before this step is reached).
  const agentPayload = (req: TerminalCreateRequest) => ({
    mode: "plan",
    projectId: req.projectId,
    moduleId: req.moduleId,
    onLaunched: selectScratchWorkspace,
    ...(hasInitialPrompt(req) ? { initialPrompt: req.initialPrompt } : {}),
  });
  return {
    hasModuleFolder(moduleId) {
      return Boolean(getModuleFolder(moduleId));
    },
    openFolderGate(req) {
      // Resume the same launch after the folder saves: chain through the prompt
      // step unless a prompt was already supplied, then agent choice.
      const nextPayload = hasInitialPrompt(req)
        ? { next: "agent-picker", nextPayload: agentPayload(req) }
        : {
            next: "prompt-input",
            nextPayload: {
              next: "agent-picker",
              nextPayload: agentPayload(req),
            },
          };
      modal.pushModal({
        type: "module-folder",
        payload: { moduleId: req.moduleId, ...nextPayload },
      });
    },
    openPromptInput(req) {
      modal.pushModal({
        type: "prompt-input",
        payload: { next: "agent-picker", nextPayload: agentPayload(req) },
      });
    },
    openAgentPicker(req) {
      modal.pushModal({ type: "agent-picker", payload: agentPayload(req) });
    },
  };
}

/**
 * Kick off the planning flow through the shared terminal-create launcher
 * (CODIN-839). The launcher decides the folder gate → optional prompt →
 * required agent sequence; `studioPlanFlow` presents each step via Studio's
 * modal chain. Behaviour is unchanged from the user's point of view.
 */
export function startPlanFlow(): void {
  const { selectedProjectId } = useStudioStore.getState();
  const { selectedModuleId } = useClientStore.getState();
  if (!selectedProjectId || !selectedModuleId) return;
  const req: TerminalCreateRequest = {
    projectId: selectedProjectId,
    moduleId: selectedModuleId,
  };
  beginTerminalCreate(req, studioPlanFlow());
}

function launchSelectedConversation(
  projectId: string,
  moduleId: string,
): void {
  void launchInstantConversation({ projectId, moduleId }).catch((error) => {
    const message = error instanceof Error
      ? error.message
      : "The conversation could not be started.";
    useModalStore.getState().notifyUser({
      id: `conversation-launch:${crypto.randomUUID()}`,
      severity: "error",
      title: "Conversation did not start",
      message,
      acknowledgementLabel: "Close",
    });
  });
}

/** Launch the configured global default and let the user type in its terminal. */
export function startInstantChangeFlow(): void {
  const tasks = {
    ...useStudioStore.getState(),
    ...useClientStore.getState(),
  };
  const { selectedProjectId, selectedModuleId } = tasks;
  if (!selectedProjectId || !selectedModuleId) return;
  const folder = getModuleFolder(selectedModuleId);

  if (!folder) {
    useModalStore.getState().pushModal({
      type: "module-folder",
      payload: {
        moduleId: selectedModuleId,
        onSaved: () => launchSelectedConversation(
          selectedProjectId,
          selectedModuleId,
        ),
      },
    });
    return;
  }

  launchSelectedConversation(selectedProjectId, selectedModuleId);
}

function selectedTaskLaunchContext(): {
  projectId: string;
  moduleId: string;
  taskId: string;
} | null {
  const tasks = {
    ...useStudioStore.getState(),
    ...useClientStore.getState(),
  };
  const { selectedProjectId, selectedModuleId, selectedTaskId } = tasks;
  if (
    !selectedProjectId ||
    !selectedModuleId ||
    !selectedTaskId ||
    selectedTaskId === TEMP_TASK_ID
  ) return null;
  const selected = getWorkItemSnapshot(selectedTaskId);
  if (!selected) return null;
  return {
    projectId: selectedProjectId,
    moduleId: selectedModuleId,
    taskId: selectedTaskId,
  };
}

/** Equivalent entry for `o` (open agent on selected task). */
export function startOpenFlow(): void {
  const modal = useModalStore.getState();
  const context = selectedTaskLaunchContext();
  if (!context) return;
  const folder = getModuleFolder(context.moduleId);
  if (!folder) {
    modal.pushModal({
      type: "module-folder",
      payload: {
        moduleId: context.moduleId,
        next: "agent-picker",
        nextPayload: { mode: "open", ...context },
      },
    });
    return;
  }
  modal.pushModal({
    type: "agent-picker",
    payload: { mode: "open", ...context },
  });
}

/** Entry for shift+enter (open with prompt). */
export function startOpenWithPromptFlow(): void {
  const modal = useModalStore.getState();
  const context = selectedTaskLaunchContext();
  if (!context) return;
  const folder = getModuleFolder(context.moduleId);
  if (!folder) {
    modal.pushModal({
      type: "module-folder",
      payload: {
        moduleId: context.moduleId,
        next: "prompt-input",
        nextPayload: {
          next: "agent-picker",
          nextPayload: { mode: "open-with-prompt", ...context },
        },
      },
    });
    return;
  }
  modal.pushModal({
    type: "prompt-input",
    payload: {
      next: "agent-picker",
      nextPayload: { mode: "open-with-prompt", ...context },
    },
  });
}
