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
import { getConfigSnapshot, getModuleFolder } from "../stores/configStore";
import { TEMP_TASK_ID } from "../../agents/types";
import { useStudioStore } from "../../projects";
import { useClientStore } from "../../../state/clientStore";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import type { WorkItem } from "../../../shared/api/types";

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
      const { recentProfileIndex, profiles } = getConfigSnapshot();
      const profile =
        recentProfileIndex !== null ? profiles[recentProfileIndex] : null;
      return Boolean(getModuleFolder(profile, moduleId));
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

/**
 * Kick off the instant-change flow:
 * 1) If the selected module has no link, push ModuleFolder first
 *    (chained `next` resumes into PromptInput → AgentPicker (mode: instant)).
 * 2) Otherwise push PromptInput with `next: agent-picker, mode: instant`.
 */
export function startInstantChangeFlow(): void {
  const cfg = getConfigSnapshot();
  const tasks = {
    ...useStudioStore.getState(),
    ...useClientStore.getState(),
  };
  const modal = useModalStore.getState();

  const { recentProfileIndex, profiles } = cfg;
  const { selectedProjectId, selectedModuleId } = tasks;
  if (!selectedProjectId || !selectedModuleId) return;
  const agentPayload = {
    mode: "instant",
    projectId: selectedProjectId,
    moduleId: selectedModuleId,
    onLaunched: selectScratchWorkspace,
  };

  const profile =
    recentProfileIndex !== null ? profiles[recentProfileIndex] : null;
  const folder = getModuleFolder(profile, selectedModuleId);

  if (!folder) {
    modal.pushModal({
      type: "module-folder",
      payload: {
        moduleId: selectedModuleId,
        next: "prompt-input",
        nextPayload: { next: "agent-picker", nextPayload: agentPayload },
      },
    });
    return;
  }

  modal.pushModal({
    type: "prompt-input",
    payload: { next: "agent-picker", nextPayload: agentPayload },
  });
}

function selectedTaskLaunchContext(): {
  projectId: string;
  moduleId: string;
  taskId: string;
  ticketSeq: number | null;
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
  const selected = queryClient.getQueryData<WorkItem>(
    queryKeys.workItems.byId(selectedTaskId),
  );
  if (!selected) return null;
  return {
    projectId: selectedProjectId,
    moduleId: selectedModuleId,
    taskId: selectedTaskId,
    ticketSeq: selected.sequence_id,
  };
}

/** Equivalent entry for `o` (open agent on selected task). */
export function startOpenFlow(): void {
  const cfg = getConfigSnapshot();
  const modal = useModalStore.getState();
  const { recentProfileIndex, profiles } = cfg;
  const context = selectedTaskLaunchContext();
  if (!context) return;
  const profile =
    recentProfileIndex !== null ? profiles[recentProfileIndex] : null;
  const folder = getModuleFolder(profile, context.moduleId);
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
  const cfg = getConfigSnapshot();
  const modal = useModalStore.getState();
  const { recentProfileIndex, profiles } = cfg;
  const context = selectedTaskLaunchContext();
  if (!context) return;
  const profile =
    recentProfileIndex !== null ? profiles[recentProfileIndex] : null;
  const folder = getModuleFolder(profile, context.moduleId);
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
