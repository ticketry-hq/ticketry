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
