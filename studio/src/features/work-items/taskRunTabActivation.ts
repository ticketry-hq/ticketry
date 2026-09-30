import {
  isLiveAgentRunState,
  projectRunPresentation,
  readAgentStatusHolding,
  subscribeAgentStatusHolding,
  type RunRecord,
} from "../agents/status";
import {
  isTerminalProvider,
  useTerminalStore,
  type TerminalProvider,
} from "../agents/terminal";
import { useClientStore } from "../../state/clientStore";

export interface TaskRunTabTarget {
  taskId: string;
  projectId: string;
  moduleId: string | null;
}

function activateTaskRunTab(
  target: TaskRunTabTarget,
  run: { agentRunId: string; agent: TerminalProvider },
  viewerAttachmentDeferred = false,
): void {
  const terminal = useTerminalStore.getState();
  const existingSessionId = terminal.sessionByRun[run.agentRunId];
  if (existingSessionId && terminal.sessions[existingSessionId]) {
    if (!viewerAttachmentDeferred) {
      terminal.allowViewerAttachment(run.agentRunId);
    }
    terminal.focusSession(existingSessionId);
  } else {
    terminal.openSession({
      taskId: target.taskId,
      projectId: target.projectId,
      moduleId: target.moduleId ?? undefined,
      agent: run.agent,
      agentRunId: run.agentRunId,
      select: true,
      viewerAttachmentDeferred,
    });
  }
  useClientStore.getState().setActive(target.taskId, "terminal");
}

function matchesNewRun(
  run: RunRecord,
  target: TaskRunTabTarget,
  knownRunIds: ReadonlySet<string>,
): boolean {
  return (
    !knownRunIds.has(run.agent_run_id) &&
    run.project_id === target.projectId &&
    run.task_id === target.taskId &&
    run.scope === "task" &&
    isTerminalProvider(run.agent) &&
    isLiveAgentRunState(projectRunPresentation(run))
  );
}

export interface NewTaskRunTabWatch {
  acknowledge(): void;
  cancel(): void;
}

export function watchNewTaskRunTab(target: TaskRunTabTarget): NewTaskRunTabWatch {
  const knownRunIds = new Set(Object.keys(readAgentStatusHolding().runs));
  let stopped = false;
  let acknowledged = false;
  let discoveredRunId: string | null = null;
  let unsubscribe: (() => void) | null = null;
  let expiration: ReturnType<typeof setTimeout> | null = null;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    unsubscribe?.();
    unsubscribe = null;
    if (expiration) clearTimeout(expiration);
    expiration = null;
  };
  const inspect = (): void => {
    if (stopped) return;
    const holding = readAgentStatusHolding();
    if (holding.projectId !== target.projectId) return;
    const run = Object.values(holding.runs).find((candidate) =>
      matchesNewRun(candidate, target, knownRunIds),
    );
    if (!run || !isTerminalProvider(run.agent)) return;
    discoveredRunId = run.agent_run_id;
    stop();
    activateTaskRunTab(target, {
      agentRunId: run.agent_run_id,
      agent: run.agent,
    }, !acknowledged);
  };

  unsubscribe = subscribeAgentStatusHolding(inspect);
  if (stopped) unsubscribe();
  inspect();
  if (!stopped) expiration = setTimeout(stop, 30_000);
  return {
    acknowledge() {
      acknowledged = true;
      if (discoveredRunId) {
        useTerminalStore.getState().allowViewerAttachment(discoveredRunId);
      }
    },
    cancel: stop,
  };
}

export function activateAcknowledgedTaskRunTab(
  target: TaskRunTabTarget,
  run: { agent_run_id: string; agent: string },
): void {
  if (!isTerminalProvider(run.agent)) return;
  activateTaskRunTab(target, {
    agentRunId: run.agent_run_id,
    agent: run.agent,
  });
}
