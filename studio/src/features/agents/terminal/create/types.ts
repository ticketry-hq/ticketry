import type { SessionMeta } from "../internal/sessionStore";

// Shared terminal-create launcher (CODIN-839). Studio create surfaces reach the
// same folder gate → optional prompt → required agent → scratch planning launch
// through one seam. Deliberately generic: it owns the *sequencing policy* and
// the *launch contract*, and delegates how each step is presented to the caller.

/**
 * Caller-supplied context for a terminal-create flow. Studio callers pass
 * resolved module context directly. `initialPrompt`, when non-blank, skips the
 * prompt step.
 */
export interface TerminalCreateRequest {
  projectId: string;
  moduleId: string;
  initialPrompt?: string | null;
}

/**
 * The three ordered entry points a terminal-create flow can begin at. The caller
 * wires each opener to its own surface. These push the existing ModuleFolder →
 * PromptInput → AgentPicker modal chain, each of which resumes
 * the pending launch into the next step.
 */
export interface TerminalCreateFlow {
  /** True when `moduleId` already has a working folder in the active context. */
  hasModuleFolder: (moduleId: string) => boolean;
  /** Open the module-folder gate; must resume the launch after the folder saves. */
  openFolderGate: (req: TerminalCreateRequest) => void;
  /** Open the prompt step; must resume into agent choice on submit. */
  openPromptInput: (req: TerminalCreateRequest) => void;
  /** Open the always-required agent choice, carrying any supplied prompt. */
  openAgentPicker: (req: TerminalCreateRequest) => void;
}

/** The fixed scratch-planning launch inputs, once an agent has been chosen. */
export interface ScratchPlanningLaunch {
  projectId: string;
  moduleId: string;
  agent: SessionMeta["agent"];
  initialPrompt: string | null;
}
