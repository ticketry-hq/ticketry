import type { AgentStatusData, RunRecord } from "../status";
import { isTerminalProvider } from "./presentation/providerPresentation";
import { isScratchBucket } from "./internal/sessionStore";

/**
 * Runs whose durable terminals belong in the mounted workspace bucket.
 *
 * ProjectRunStatus is the live-tab discovery authority. Terminal attachment is
 * addressed by agent_run_id, so a second AgentTerminalSessions listing adds no
 * identity the viewer needs and can disagree with the status snapshot's scope.
 * Ended runs remain in this result so reconciliation clears their local
 * restoration bookkeeping without reopening them.
 */
export function selectWorkspaceTerminalRuns(
  holding: AgentStatusData,
  bucket: string | null,
  projectId: string | null,
  moduleId: string | null,
): RunRecord[] {
  if (!bucket || !projectId || holding.projectId !== projectId) return [];
  const scratch = isScratchBucket(bucket);
  return Object.values(holding.runs)
    .filter((run) => isTerminalProvider(run.agent))
    .filter((run) => {
      if (!scratch) return run.task_id === bucket && run.scope === "task";
      return run.project_id === projectId &&
        run.module_id === moduleId &&
        (run.scope === "plan" || run.scope === "instant");
    })
    .sort((left, right) =>
      (left.started_at ?? "").localeCompare(right.started_at ?? "") ||
      left.agent_run_id.localeCompare(right.agent_run_id)
    );
}

/**
 * Resolve disagreement windows between pushed status and resumable holdings.
 * A run already proven resumable stays out of restoration even if status calls
 * it live. Within one provider conversation, only its newest run may restore,
 * which prevents a stale predecessor reopening beside its live successor.
 */
export function excludeResumableTerminalRuns(
  runs: readonly RunRecord[],
  knownResumableRunIds: ReadonlySet<string>,
): readonly RunRecord[] {
  const latestByConversation = new Map<string, string>();
  for (const run of runs) {
    if (run.provider_session_id) {
      latestByConversation.set(run.provider_session_id, run.agent_run_id);
    }
  }
  const filtered = runs.filter((run) =>
    !knownResumableRunIds.has(run.agent_run_id) &&
    (!run.provider_session_id ||
      latestByConversation.get(run.provider_session_id) === run.agent_run_id)
  );
  return filtered.length === runs.length ? runs : filtered;
}
