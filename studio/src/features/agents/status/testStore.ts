/**
 * Test-only compatibility facade while production uses Apollo-backed
 * hooks directly. This is not an entity store. Every read and write goes
 * through the normalized Apollo cache.
 */
import type {
  AgentStatusData,
  AgentStatusScope,
  AutomationAttemptRecord,
  RawLifecycleState,
  RunPresentationState,
  RunRecord,
} from "./types";
import {
  advanceAgentStatusStallEpoch,
  applyAgentRunActivity,
  applyAgentRunState,
  pruneAgentRuns,
  readAgentStatusHolding,
  replaceAgentStatusHolding,
  replaceAgentStatusSnapshot,
  subscribeAgentStatusHolding,
  switchAgentStatusProject,
  upsertAgentRun,
  upsertAutomationAttempt,
} from "./apolloHolding";
import { useAgentStatusSelection } from "./hooks";

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

const actions: AgentStatusActions = {
  switchProject: switchAgentStatusProject,
  upsertRun: upsertAgentRun,
  applyActivity: (run) => void applyAgentRunActivity(run),
  advanceStallEpoch: advanceAgentStatusStallEpoch,
  applyState: (runId, state, at, exitCode, effectiveState) => {
    applyAgentRunState(runId, state, at, exitCode, effectiveState);
  },
  reconcileScope: (scope, runs) => {
    const current = readAgentStatusHolding();
    if (scope.task_id === null) {
      replaceAgentStatusSnapshot(
        scope.project_id,
        runs,
        Object.values(current.automationAttempts),
      );
      return;
    }
    const outsideScope = Object.values(current.runs).filter(
      (run) => run.task_id !== scope.task_id,
    );
    replaceAgentStatusSnapshot(
      scope.project_id,
      [...outsideScope, ...runs],
      Object.values(current.automationAttempts),
    );
  },
  upsertAutomationAttempt,
  reconcileAutomationAttempts: (attempts) => {
    const current = readAgentStatusHolding();
    if (!current.projectId) return;
    replaceAgentStatusSnapshot(
      current.projectId,
      Object.values(current.runs),
      attempts,
    );
  },
  pruneRuns: pruneAgentRuns,
};

function state(): AgentStatusStore {
  return { ...readAgentStatusHolding(), ...actions };
}

interface AgentStatusFacade {
  <T>(select: (holding: AgentStatusStore) => T): T;
  getState(): AgentStatusStore;
  setState(next: Partial<AgentStatusStore>): void;
  subscribe(listener: (holding: AgentStatusStore) => void): () => void;
}

export const useAgentStatusStore: AgentStatusFacade = Object.assign(
  <T>(select: (holding: AgentStatusStore) => T): T =>
    useAgentStatusSelection((holding) => select({ ...holding, ...actions })),
  {
    getState: state,
    setState(next: Partial<AgentStatusStore>) {
      const current = readAgentStatusHolding();
      const suppliedRuns = next.runs ?? current.runs;
      const firstRun = Object.values(suppliedRuns)[0];
      const projectId = next.projectId === undefined
        ? current.projectId ?? firstRun?.project_id ?? "__status-test__"
        : next.projectId;
      const nextRuns = Object.fromEntries(
        Object.entries(suppliedRuns).map(([runId, run]) => [
          runId,
          {
            agent_run_id: run.agent_run_id ?? runId,
            project_id: run.project_id ?? projectId ?? undefined,
            task_id: run.task_id ?? null,
            module_id: run.module_id,
            agent: run.agent ?? null,
            scope: run.scope ?? "task",
            launch_state: run.launch_state ?? null,
            launch_model: run.launch_model ?? null,
            provider_session_id: run.provider_session_id ?? null,
            started_at: run.started_at ?? "1970-01-01T00:00:00Z",
            state: run.state,
            effective_state: run.effective_state ?? run.state,
            updated_at: run.updated_at ?? "1970-01-01T00:00:00Z",
            exit_code: run.exit_code ?? null,
            output_sequence: run.output_sequence ?? 0,
            last_output_at: run.last_output_at ?? null,
          },
        ]),
      );
      replaceAgentStatusHolding({
        projectId,
        runs: nextRuns,
        automationAttempts:
          next.automationAttempts ?? current.automationAttempts,
        automationByTask: next.automationByTask ?? current.automationByTask,
        stallEpoch: next.stallEpoch ?? current.stallEpoch,
      });
    },
    subscribe(listener: (holding: AgentStatusStore) => void) {
      return subscribeAgentStatusHolding(() => listener(state()));
    },
  },
);
