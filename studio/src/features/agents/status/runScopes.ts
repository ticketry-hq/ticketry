import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { SCRATCH_RUN_TASK_ID } from "../types";
import type { AgentRunScope, RunRecord } from "./types";

/**
 * The scope of a run with no provider at all, whose durable terminal session
 * hosts a plain interactive shell. It is the one scope whose runs carry a null
 * `agent`.
 */
export const SHELL_RUN_SCOPE: AgentRunScope = "shell";

/** Scopes whose runs legitimately carry no provider. */
const AGENTLESS_SCOPES: ReadonlySet<AgentRunScope> = new Set([SHELL_RUN_SCOPE]);

/**
 * Whether a run has no provider.
 *
 * Every surface that reads a run's `agent` needs an answer to this, and the
 * answer is a property of the run's scope rather than of the field happening to
 * be missing on the wire — so readers branch on the scope and never invent a
 * substitute provider slug.
 */
export function isAgentlessRun(run: Pick<RunRecord, "scope">): boolean {
  return AGENTLESS_SCOPES.has(run.scope);
}

/**
 * Whether a run is a Work Item's own login shell (`task_shell`).
 *
 * It shares the agentless `"shell"` scope with a module shell; only its owner
 * differs. A module shell carries no task (or the scratch sentinel), while a
 * Work Item shell carries that Work Item's id, so its terminal belongs in the
 * Work Item's workspace beside the agent terminals rather than in the panel.
 */
export function isWorkItemShellRun(
  run: Pick<RunRecord, "scope" | "task_id">,
): boolean {
  return run.scope === SHELL_RUN_SCOPE &&
    !!run.task_id &&
    compactWorktrackerId(run.task_id) !== compactWorktrackerId(SCRATCH_RUN_TASK_ID);
}
