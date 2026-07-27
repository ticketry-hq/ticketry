import { create } from "zustand";
import type {
  AgentStatusData,
  AgentStatusRun,
  AgentStatusScope,
  AutomationAttemptRecord,
  RawLifecycleState,
  RunRecord,
} from "./types";

interface AgentStatusActions {
  switchProject: (projectId: string) => void;
  upsertRun: (run: RunRecord) => void;
  applyState: (runId: string, state: RawLifecycleState, at: string) => void;
  reconcileScope: (scope: AgentStatusScope, runs: RunRecord[], at: string) => void;
  upsertAutomationAttempt: (attempt: AutomationAttemptRecord) => void;
  reconcileAutomationAttempts: (attempts: AutomationAttemptRecord[]) => void;
  pruneRuns: (olderThan: string) => void;
  acceptWorkItemCursor: (projectId: string, revision: number) => void;
}

export type AgentStatusStore = AgentStatusData & AgentStatusActions & {
  /** Project replay cursors retained for the lifetime of this browser page. */
  workItemCursors: Record<string, number>;
};

function isOlder(candidate: string, current: string): boolean {
  return Date.parse(candidate) < Date.parse(current);
}

const TERMINAL_STATES: ReadonlySet<string> = new Set(["exited", "lost", "error"]);
const PRUNABLE_STATES: ReadonlySet<string> = new Set(["exited", "lost"]);

/**
 * Order-independent write rule: a strictly newer frame always wins; an older
 * one never does. On an equal timestamp the outcome must not depend on frame
 * arrival order (snapshot vs delta), so the only tie-breaker is terminality —
 * a terminal state beats a non-terminal one, everything else keeps what's
 * already there.
 */
function supersedes(incoming: AgentStatusRun, current: AgentStatusRun): boolean {
  const cmp = Date.parse(incoming.updatedAt) - Date.parse(current.updatedAt);
  if (cmp !== 0) return cmp > 0;
  return TERMINAL_STATES.has(incoming.state) && !TERMINAL_STATES.has(current.state);
}

function normalize(run: RunRecord): AgentStatusRun {
  return {
    runId: run.agent_run_id,
    taskId: run.task_id,
    moduleId: run.module_id,
    scope: run.scope,
    state: run.state,
    updatedAt: run.updated_at,
  };
}

function removeFromTask(
  byTask: Record<string, string[]>,
  taskId: string | null,
  runId: string,
): void {
  if (!taskId) return;
  const remaining = (byTask[taskId] ?? []).filter((id) => id !== runId);
  if (remaining.length) byTask[taskId] = remaining;
  else delete byTask[taskId];
}

function putRun(data: AgentStatusData, incoming: AgentStatusRun): void {
  const current = data.runs[incoming.runId];
  if (current && !supersedes(incoming, current)) return;

  if (current?.taskId !== incoming.taskId) {
    removeFromTask(data.byTask, current?.taskId ?? null, incoming.runId);
  }
  data.runs[incoming.runId] = incoming;
  if (incoming.taskId) {
    const ids = data.byTask[incoming.taskId] ?? [];
    if (!ids.includes(incoming.runId)) data.byTask[incoming.taskId] = [...ids, incoming.runId];
  }
}

function mutableCopy(state: AgentStatusData): AgentStatusData {
  return {
    projectId: state.projectId,
    runs: { ...state.runs },
    byTask: Object.fromEntries(
      Object.entries(state.byTask).map(([taskId, runIds]) => [taskId, [...runIds]]),
    ),
    automationAttempts: { ...state.automationAttempts },
    automationByTask: Object.fromEntries(
      Object.entries(state.automationByTask).map(([taskId, roots]) => [
        taskId,
        [...roots],
      ]),
    ),
  };
}

function removeAutomationRoot(
  data: AgentStatusData,
  taskId: string,
  rootId: string,
): void {
  const remaining = (data.automationByTask[taskId] ?? []).filter(
    (id) => id !== rootId,
  );
  if (remaining.length) data.automationByTask[taskId] = remaining;
  else delete data.automationByTask[taskId];
}

function putAutomationAttempt(
  data: AgentStatusData,
  attempt: AutomationAttemptRecord,
): void {
  const rootId = attempt.root_attempt_id;
  const current = data.automationAttempts[rootId];
  if (current) {
    const timestampOrder =
      Date.parse(attempt.updated_at) - Date.parse(current.updated_at);
    const statusRank = { pending: 0, failed: 1, succeeded: 2 } as const;
    if (
      timestampOrder < 0 ||
      (timestampOrder === 0 &&
        statusRank[attempt.status] <= statusRank[current.status])
    ) {
      return;
    }
  }
  if (current && current.work_item_id !== attempt.work_item_id) {
    removeAutomationRoot(data, current.work_item_id, rootId);
  }
  data.automationAttempts[rootId] = attempt;
  const roots = data.automationByTask[attempt.work_item_id] ?? [];
  if (!roots.includes(rootId)) {
    data.automationByTask[attempt.work_item_id] = [...roots, rootId];
  }
}

export const useAgentStatusStore = create<AgentStatusStore>((set) => ({
  projectId: null,
  runs: {},
  byTask: {},
  automationAttempts: {},
  automationByTask: {},
  workItemCursors: {},

  switchProject(projectId) {
    set((state) => state.projectId === projectId
      ? state
      : {
          projectId,
          runs: {},
          byTask: {},
          automationAttempts: {},
          automationByTask: {},
        });
  },

  upsertRun(run) {
    set((state) => {
      const next = mutableCopy(state);
      putRun(next, normalize(run));
      return next;
    });
  },

  applyState(runId, state, at) {
    set((current) => {
      const run = current.runs[runId];
      if (!run) return current;
      const incoming = { ...run, state, updatedAt: at };
      if (!supersedes(incoming, run)) return current;
      return { ...current, runs: { ...current.runs, [runId]: incoming } };
    });
  },

  reconcileScope(scope, records, at) {
    set((state) => {
      const next = mutableCopy(state);
      const listed = new Set(records.map((record) => record.agent_run_id));
      for (const record of records) putRun(next, normalize(record));

      for (const run of Object.values(next.runs)) {
        const inScope = scope.task_id === null || run.taskId === scope.task_id;
        if (
          inScope &&
          !listed.has(run.runId) &&
          run.state !== "exited" &&
          !isOlder(at, run.updatedAt)
        ) {
          next.runs[run.runId] = { ...run, state: "exited", updatedAt: at };
        }
      }
      return next;
    });
  },

  upsertAutomationAttempt(attempt) {
    set((state) => {
      const next = mutableCopy(state);
      putAutomationAttempt(next, attempt);
      return next;
    });
  },

  reconcileAutomationAttempts(attempts) {
    set((state) => {
      const next = mutableCopy(state);
      next.automationAttempts = {};
      next.automationByTask = {};
      for (const attempt of attempts) putAutomationAttempt(next, attempt);
      return next;
    });
  },

  pruneRuns(olderThan) {
    set((state) => {
      const next = mutableCopy(state);
      for (const run of Object.values(next.runs)) {
        if (PRUNABLE_STATES.has(run.state) && isOlder(run.updatedAt, olderThan)) {
          delete next.runs[run.runId];
          removeFromTask(next.byTask, run.taskId, run.runId);
        }
      }
      return next;
    });
  },

  acceptWorkItemCursor(projectId, revision) {
    set((state) => {
      if ((state.workItemCursors[projectId] ?? -1) >= revision) return state;
      return {
        workItemCursors: { ...state.workItemCursors, [projectId]: revision },
      };
    });
  },
}));
