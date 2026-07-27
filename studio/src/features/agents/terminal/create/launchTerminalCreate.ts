import { launchAgent } from "../internal/actions";
import type { SessionId } from "../../types";
import type {
  ScratchPlanningLaunch,
  TerminalCreateFlow,
  TerminalCreateRequest,
} from "./types";

/** True when the caller supplied a usable (non-blank) initial prompt. */
export function hasInitialPrompt(req: TerminalCreateRequest): boolean {
  return (req.initialPrompt ?? "").trim().length > 0;
}

/**
 * Begin the shared terminal-create flow (CODIN-839). The sequencing policy is
 * fixed here; how each step is presented is the caller's job (see
 * `TerminalCreateFlow`):
 *
 *   1. No configured module folder → open the folder gate first (it resumes the
 *      pending launch after save).
 *   2. Otherwise, no non-blank prompt supplied → open the prompt step.
 *   3. Otherwise, go straight to the always-required agent choice.
 *
 * The agent step is never skipped by a remembered default in this slice.
 */
export function beginTerminalCreate(
  req: TerminalCreateRequest,
  flow: TerminalCreateFlow,
): void {
  if (!flow.hasModuleFolder(req.moduleId)) {
    flow.openFolderGate(req);
    return;
  }
  if (!hasInitialPrompt(req)) {
    flow.openPromptInput(req);
    return;
  }
  flow.openAgentPicker(req);
}

/**
 * Open the existing scratch planning terminal for a chosen agent. The launch
 * contract is fixed and intentionally minimal: no task (`taskId: null`,
 * `ticketSeq: null`), the caller's module, the carried prompt, and
 * `isPlanning: true`. No parent/state fields are added.
 *
 * Presentation (selecting the scratch bucket, activating a terminal workspace)
 * is the caller's responsibility — this only creates the session and returns
 * its id.
 */
export function launchScratchPlanning(launch: ScratchPlanningLaunch): SessionId {
  return launchAgent({
    taskId: null,
    projectId: launch.projectId,
    moduleId: launch.moduleId,
    agent: launch.agent,
    ticketSeq: null,
    initialPrompt: launch.initialPrompt,
    isPlanning: true,
  });
}
