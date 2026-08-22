import { create } from "zustand";
import { isTerminalOutcome } from "./runPresentation";
import type {
  AgentStatusData,
  AgentStatusScope,
  AutomationAttemptRecord,
  RawLifecycleState,
  RunPresentationState,
  RunRecord,
} from "./types";

interface AgentStatusActions {
  switchProject: (projectId: string) => void;
  upsertRun: (run: RunRecord) => void;
  applyActivity: (run: RunRecord) => void;
  advanceStallEpoch: () => void;
  applyState: (
    runId: string,
    state: RawLifecycleState,
    at: string,
    exitCode?: number | null,
    effectiveState?: RunPresentationState,
  ) => void;
  reconcileScope: (scope: AgentStatusScope, runs: RunRecord[], at: string) => void;
  upsertAutomationAttempt: (attempt: AutomationAttemptRecord) => void;
  reconcileAutomationAttempts: (attempts: AutomationAttemptRecord[]) => void;
  pruneRuns: (olderThan: string) => void;
}

export type AgentStatusStore = AgentStatusData & AgentStatusActions;

function isOlder(candidate: string, current: string): boolean {
  return Date.parse(candidate) < Date.parse(current);
}

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
  return isTerminalOutcome(incoming.state) && !isTerminalOutcome(current.state);
}

function outputSequence(run: RunRecord | undefined): number {
  return run?.output_sequence ?? 0;
}

/**
 * Merge the two axes independently. A lifecycle frame is ordered by its
 * lifecycle timestamp and an activity observation by its output sequence, so
 * an older activity frame riding along with a newer lifecycle fact (or the
 * reverse) can never rewind the other axis. `last_output_at` is deliberately
 * never compared against the lifecycle timestamp.
 */
function mergeAxes(current: RunRecord | undefined, incoming: RunRecord): RunRecord {
  if (!current || outputSequence(incoming) >= outputSequence(current)) {
    return incoming;
  }
  return {
    ...incoming,
    // The accepted lifecycle fact was projected against an older activity
    // axis. Recompute from the newer local output time instead of keeping its
    // stale effective overlay.
    effective_state: incoming.state,
    output_sequence: current.output_sequence,
    last_output_at: current.last_output_at,
  };
}

function putRun(data: AgentStatusData, incoming: RunRecord): void {
  const current = data.runs[incoming.agent_run_id];
  if (current && !supersedes(incoming, current)) {
    // The lifecycle axis loses, but a newer activity fact travelling with this
    // frame must still be kept: the axes are ordered independently. A run that
    // already reached an outcome is the exception — nothing about a dead run
    // is still moving, so its activity axis is frozen with it (#663).
    if (
      !isTerminalOutcome(current.state) &&
      outputSequence(incoming) > outputSequence(current)
    ) {
      data.runs[incoming.agent_run_id] = {
        ...current,
        effective_state: incoming.effective_state,
        output_sequence: incoming.output_sequence,
        last_output_at: incoming.last_output_at,
      };
    }
    return;
  }
  data.runs[incoming.agent_run_id] = mergeAxes(current, incoming);
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
    isTerminalOutcome(current.state) &&
    !isTerminalOutcome(incoming.state)
  ) {
    data.runs[incoming.agent_run_id] = mergeAxes(current, incoming);
    return;
  }
  putRun(data, incoming);
}

function mutableCopy(state: AgentStatusData): AgentStatusData {
  return {
    projectId: state.projectId,
    stallEpoch: state.stallEpoch,
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
  stallEpoch: 0,

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

  /**
   * Apply one terminal-output activity delta. The activity axis advances only
   * for a strictly newer output sequence, and the delta never claims a
   * lifecycle state of its own: an unknown run is adopted whole, a known one
   * keeps the provider lifecycle fact it already holds so changed output
   * restores that state rather than manufacturing `working`.
   *
   * A run that already reached an authoritative outcome is left entirely
   * alone. Its projection is terminal either way, but freezing the axis stops
   * an observation that raced the ending from stamping a post-mortem
   * `last_output_at` that a later frame could re-arm a deadline from (#663).
   */
  applyActivity(run) {
    set((state) => {
      const current = state.runs[run.agent_run_id];
      if (current && isTerminalOutcome(current.state)) return state;
      if (current && outputSequence(run) <= outputSequence(current)) return state;
      const merged = current
        ? {
            ...current,
            effective_state: run.effective_state,
            output_sequence: run.output_sequence,
            last_output_at: run.last_output_at,
          }
        : run;
      return { ...state, runs: { ...state.runs, [run.agent_run_id]: merged } };
    });
  },

  advanceStallEpoch() {
    set((state) => ({ ...state, stallEpoch: state.stallEpoch + 1 }));
  },

  /**
   * Apply one pushed ending to a run already held here.
   *
   * `exitCode` is the hosted command's own result travelling with that ending.
   * It is recorded only when the ending itself wins the lifecycle axis, and an
   * ending that observed no code leaves whatever was recorded before it — a
   * process result is a fact about the process, never something an ending with
   * nothing to report may erase (#670).
   */
  applyState(runId, state, at, exitCode, effectiveState) {
    set((current) => {
      const run = current.runs[runId];
      if (!run) return current;
      const incoming = {
        ...run,
        state,
        effective_state: effectiveState ?? state,
        updated_at: at,
        exit_code: exitCode ?? run.exit_code ?? null,
      };
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
