import { create } from "zustand";
import type {
  AgentStatusData,
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
}

export type AgentStatusStore = AgentStatusData & AgentStatusActions;

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
function supersedes(incoming: RunRecord, current: RunRecord): boolean {
  const cmp = Date.parse(incoming.updated_at) - Date.parse(current.updated_at);
  if (cmp !== 0) return cmp > 0;
  return TERMINAL_STATES.has(incoming.state) && !TERMINAL_STATES.has(current.state);
}

function putRun(data: AgentStatusData, incoming: RunRecord): void {
  const current = data.runs[incoming.agent_run_id];
  if (current && !supersedes(incoming, current)) return;
  data.runs[incoming.agent_run_id] = incoming;
}

/**
 * Snapshot write rule. A snapshot is the first frame on its socket and every
 * backend ending is published only after its transaction commits, so a
 * snapshot that lists a run as alive is authoritative: a terminal state held
 * locally that the snapshot contradicts was either fabricated here (a run a
 * previous snapshot raced past) or has since been repaired server-side. A
 * quiet run's authoritative record keeps its last hook timestamp — often
 * hours old — so waiting for a strictly newer frame would leave the wrong
 * "terminated" pinned until the agent happens to emit again.
 */
function putSnapshotRun(data: AgentStatusData, incoming: RunRecord): void {
  const current = data.runs[incoming.agent_run_id];
  if (
    current &&
    TERMINAL_STATES.has(current.state) &&
    !TERMINAL_STATES.has(incoming.state)
  ) {
    data.runs[incoming.agent_run_id] = incoming;
    return;
  }
  putRun(data, incoming);
}

function mutableCopy(state: AgentStatusData): AgentStatusData {
  return {
    projectId: state.projectId,
    runs: { ...state.runs },
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
  automationAttempts: {},
  automationByTask: {},

  switchProject(projectId) {
    set((state) => state.projectId === projectId
      ? state
      : {
          projectId,
          runs: {},
          automationAttempts: {},
          automationByTask: {},
        });
  },

  upsertRun(run) {
    set((state) => {
      const next = mutableCopy(state);
      putRun(next, run);
      return next;
    });
  },

  applyState(runId, state, at) {
    set((current) => {
      const run = current.runs[runId];
      if (!run) return current;
      const incoming = { ...run, state, updated_at: at };
      if (!supersedes(incoming, run)) return current;
      return { ...current, runs: { ...current.runs, [runId]: incoming } };
    });
  },

  reconcileScope(scope, records, at) {
    set((state) => {
      const next = mutableCopy(state);
      const listed = new Set(records.map((record) => record.agent_run_id));
      for (const record of records) putSnapshotRun(next, record);

      for (const run of Object.values(next.runs)) {
        const inScope = scope.task_id === null || run.task_id === scope.task_id;
        // Only a run strictly older than the snapshot stamp may be reconciled
        // as absent: the stamp is taken before the backend reads its rows, so
        // a run spawned while they were read is newer than ``at`` and must
        // not be declared exited by the snapshot that raced past it.
        if (
          inScope &&
          !listed.has(run.agent_run_id) &&
          run.state !== "exited" &&
          isOlder(run.updated_at, at)
        ) {
          next.runs[run.agent_run_id] = { ...run, state: "exited", updated_at: at };
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
        if (PRUNABLE_STATES.has(run.state) && isOlder(run.updated_at, olderThan)) {
          delete next.runs[run.agent_run_id];
        }
      }
      return next;
    });
  },
}));
