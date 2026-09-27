import { AGENT_RUN_ACTIONS, dispatchAgentRunAction } from "../actions/agentRunActions";
import { selectRunState } from "../status/selectors";
import { useAgentStatusSelection } from "../status/hooks";

const TRUST_REASON =
  "Claude is waiting for folder trust. Open its terminal to approve or decline.";
const STARTUP_REASON =
  "Claude startup needs attention. Open its terminal to continue.";

/** An explicit route to the existing run when Claude startup needs a person. */
export function ClaudeStartupAttentionAction({
  issueId,
  runId,
  projectId,
  moduleId,
}: {
  issueId?: string;
  runId?: string;
  projectId?: string;
  moduleId?: string;
}) {
  const attention = useAgentStatusSelection((holding) => {
    const runs = Object.values(holding.runs)
      .filter((run) =>
        (runId ? run.agent_run_id === runId
          : issueId ? run.task_id === issueId
          : run.project_id === projectId && run.module_id === moduleId &&
            (run.scope === "plan" || run.scope === "instant")) &&
        run.agent === "claude" &&
        selectRunState(holding, run.agent_run_id) === "needs_input" &&
        (run.attention_reason === TRUST_REASON ||
          run.attention_reason === STARTUP_REASON),
      )
      .sort((a, b) =>
        (b.started_at ?? b.updated_at).localeCompare(a.started_at ?? a.updated_at),
      );
    const run = runs[0];
    return run ? { runId: run.agent_run_id, reason: run.attention_reason! } : null;
  });
  if (!attention) return null;

  return (
    <button
      type="button"
      aria-label={attention.reason}
      title={attention.reason}
      className="border border-lifecycle-attention/70 px-1 text-[10px] font-bold leading-4 text-lifecycle-attention hover:bg-lifecycle-attention/10"
      onClick={(event) => {
        event.stopPropagation();
        void dispatchAgentRunAction(AGENT_RUN_ACTIONS.focusAgentRun, {
          runId: attention.runId,
        });
      }}
    >
      Open terminal
    </button>
  );
}
