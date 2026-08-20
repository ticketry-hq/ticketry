import { createAgentStatusClient } from "@worktracker/typescript-sdk/agent-status";
import {
  projectRunPresentation,
  useAgentStatusStore,
  type RunPresentationState,
  type RunRecord,
} from "../../features/agents/status";
import { getTerminals } from "../../features/agents/api/agentApi";
import {
  useTerminalStore,
  useWorkspaceTabsStore,
  type SessionMeta,
} from "../../features/agents/terminal/appNavigation";
import { launchFailureMessage } from "../../features/agents/terminal/internal/launchFailure";
import { agentApiBase, apiKey } from "../../shared/api/client";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { toast } from "../../state/clientStore";
import { useModalStore } from "../modal/modalStore";

export interface WorkItemActivationContext {
  projectId: string;
  moduleId: string;
  taskId: string;
}

export type WorkItemActivationIntent =
  | "open-default-terminal"
  | "choose-provider";

const LIVE_RUN_STATES: ReadonlySet<RunPresentationState> = new Set([
  "starting",
  "working",
  "needs_input",
  "permission_required",
  "turn_complete",
  "quiet",
  "stalled",
  "reconnecting",
]);

const ATTACHED_SESSION_STATES = new Set([
  "connecting",
  "ready",
  "reconnecting",
]);

const pendingReveals = new Map<string, Promise<void>>();
const pendingLaunches = new Set<string>();

function liveTaskRuns(taskId: string): RunRecord[] {
  return Object.values(useAgentStatusStore.getState().runs)
    .filter((run) => run.task_id === taskId && run.scope === "task")
    .filter((run) => typeof run.agent === "string" && run.agent.length > 0)
    .filter((run) => LIVE_RUN_STATES.has(projectRunPresentation(run)));
}

function newestRun(left: RunRecord, right: RunRecord): number {
  const started = (right.started_at ?? "").localeCompare(left.started_at ?? "");
  return started || right.agent_run_id.localeCompare(left.agent_run_id);
}

export function selectLiveWorkItemRun(taskId: string): RunRecord | null {
  const runs = liveTaskRuns(taskId);
  if (runs.length === 0) return null;

  const tabs = useWorkspaceTabsStore.getState();
  const terminal = useTerminalStore.getState();
  const selectedSessionId = tabs.activeByTask[taskId];
  const selectedRunId = selectedSessionId
    ? terminal.sessions[selectedSessionId]?.agentRunId
    : null;
  const selected = selectedRunId
    ? runs.find((run) => run.agent_run_id === selectedRunId)
    : undefined;
  return selected ?? [...runs].sort(newestRun)[0] ?? null;
}

function showTerminal(taskId: string, sessionId: string): void {
  const tabs = useWorkspaceTabsStore.getState();
  tabs.setActive(taskId, "terminal");
  tabs.tabSelected(taskId, sessionId);
}

async function restoreTerminal(taskId: string, run: RunRecord): Promise<void> {
  const persisted = await getTerminals(taskId);
  queryClient.setQueryData(
    queryKeys.terminalSessions.persisted(taskId),
    persisted,
  );
  const terminal = persisted.find(
    (session) => session.agent_run_id === run.agent_run_id,
  );
  if (!terminal) {
    throw new Error("persisted terminal metadata is not available yet");
  }
  const sessionId = useTerminalStore.getState().attachPersisted(terminal);
  showTerminal(taskId, sessionId);
}

function revealRun(taskId: string, run: RunRecord): void {
  const terminal = useTerminalStore.getState();
  const sessionId = terminal.sessionByRun[run.agent_run_id];
  const session = sessionId ? terminal.sessions[sessionId] : undefined;
  if (session && ATTACHED_SESSION_STATES.has(session.status)) {
    showTerminal(taskId, session.sessionId);
    return;
  }

  const pendingKey = `${taskId}:${run.agent_run_id}`;
  if (pendingReveals.has(pendingKey)) return;
  const request = restoreTerminal(taskId, run)
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : "unknown error";
      toast.error(`Could not reopen terminal: ${reason}`);
    })
    .finally(() => pendingReveals.delete(pendingKey));
  pendingReveals.set(pendingKey, request);
}

/** Reveal the selected work item's live task run, if it has one. */
export function revealLiveWorkItemTerminal(taskId: string): boolean {
  const run = selectLiveWorkItemRun(taskId);
  if (!run) return false;
  revealRun(taskId, run);
  return true;
}

function revealPendingAttachment(taskId: string): boolean {
  const terminal = useTerminalStore.getState();
  const runs = useAgentStatusStore.getState().runs;
  const pending = Object.values(terminal.sessions).find((session) =>
    session.taskId === taskId &&
    session.agentRunId !== null &&
    session.status === "connecting" &&
    !runs[session.agentRunId]
  );
  if (!pending) return false;
  showTerminal(taskId, pending.sessionId);
  return true;
}

async function launchDefaultWorkItemAgent(
  { projectId, moduleId, taskId }: WorkItemActivationContext,
): Promise<void> {
  try {
    const client = createAgentStatusClient({
      baseUrl: agentApiBase(),
      apiKey: apiKey(),
    });
    const launched = await client.launchAgent({ issueId: taskId });
    useTerminalStore.getState().openSession({
      taskId,
      projectId,
      moduleId,
      agent: launched.agent as SessionMeta["agent"],
      agentRunId: launched.agent_run_id,
      select: true,
    });
    useWorkspaceTabsStore.getState().setActive(taskId, "terminal");
  } catch (error) {
    toast.error(
      `Agent run could not be started: ${launchFailureMessage(error)}`,
    );
  } finally {
    pendingLaunches.delete(taskId);
  }
}

/** Open the existing provider picker for a resolved real work item. */
export function activateSelectedWorkItem(
  { projectId, moduleId, taskId }: WorkItemActivationContext,
  intent: WorkItemActivationIntent,
): boolean {
  if (intent === "open-default-terminal") {
    if (revealLiveWorkItemTerminal(taskId)) return true;
    if (pendingLaunches.has(taskId)) return true;
    if (revealPendingAttachment(taskId)) return true;
    pendingLaunches.add(taskId);
    void launchDefaultWorkItemAgent({ projectId, moduleId, taskId });
    return true;
  }
  useModalStore.getState().pushModal({
    type: "agent-picker",
    payload: { mode: "open", projectId, moduleId, taskId },
  });
  return true;
}
