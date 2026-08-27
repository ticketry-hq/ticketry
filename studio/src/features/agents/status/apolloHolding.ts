import { gql } from "@apollo/client";

import { studioApolloClient } from "../../../shared/apollo/client";
import {
  isAwaitingUser,
  isTerminalOutcome,
  stallDeadlineAt,
} from "./runPresentation";
import type {
  AgentStatusData,
  AutomationAttemptRecord,
  RunRecord,
} from "./types";

const ActiveProjectRunStatusDocument = gql`
  query ActiveProjectRunStatus {
    activeProjectRunStatus @client {
      __typename
      projectId
      stallEpoch
      runs {
        __typename
        id
        projectId @client
        taskId @client
        moduleId @client
        agent
        scope
        launchState
        launchModel
        startedAt
        state @client
        effectiveState @client
        updatedAt @client
        exitCode
        outputSequence @client
        lastOutputAt @client
      }
      automationAttempts {
        __typename
        rootAttemptId
        attemptId
        retryOfAttemptId
        workItemId
        status
        error
        failure
        retryable
        agentRunId
        updatedAt
      }
    }
  }
`;

const AgentRunStatusFragment = gql`
  fragment AgentRunStatusFields on AgentRuns {
    __typename
    id
    projectId @client
    taskId @client
    moduleId @client
    agent
    scope
    launchState
    launchModel
    startedAt
    state @client
    effectiveState @client
    updatedAt @client
    exitCode
    outputSequence @client
    lastOutputAt @client
  }
`;

interface CachedRun {
  __typename: "AgentRuns";
  id: string;
  projectId: string | null;
  taskId: string | null;
  moduleId: string;
  agent: string | null;
  scope: string;
  launchState: string | null;
  launchModel: string | null;
  startedAt: string | null;
  state: string;
  effectiveState: string | null;
  updatedAt: string;
  exitCode: number | null;
  outputSequence: number;
  lastOutputAt: string | null;
}

interface CachedAttempt {
  __typename: "AutomationAttemptStatus";
  rootAttemptId: string;
  attemptId: string;
  retryOfAttemptId: string | null;
  workItemId: string;
  status: string;
  error: string | null;
  failure: AutomationAttemptRecord["failure"];
  retryable: boolean;
  agentRunId: string | null;
  updatedAt: string;
}

interface CachedHolding {
  __typename: "ProjectRunStatus";
  projectId: string;
  stallEpoch: number;
  runs: CachedRun[];
  automationAttempts: CachedAttempt[];
}

interface HoldingQueryData {
  activeProjectRunStatus: CachedHolding | null;
}

const EMPTY_HOLDING: AgentStatusData = {
  projectId: null,
  runs: {},
  automationAttempts: {},
  automationByTask: {},
  stallEpoch: 0,
};

let lastCachedHolding: CachedHolding | null = null;
let lastHolding: AgentStatusData = EMPTY_HOLDING;

function cacheRun(run: RunRecord): CachedRun {
  return {
    __typename: "AgentRuns",
    id: run.agent_run_id,
    projectId: run.project_id ?? null,
    taskId: run.task_id,
    moduleId: run.module_id,
    agent: run.agent ?? null,
    scope: run.scope,
    launchState: run.launch_state ?? null,
    launchModel: run.launch_model ?? null,
    startedAt: run.started_at ?? null,
    state: run.state,
    effectiveState: run.effective_state ?? null,
    updatedAt: run.updated_at,
    exitCode: run.exit_code ?? null,
    outputSequence: run.output_sequence ?? 0,
    lastOutputAt: run.last_output_at ?? null,
  };
}

function runRecord(run: CachedRun): RunRecord {
  return {
    agent_run_id: run.id,
    project_id: run.projectId ?? undefined,
    task_id: run.taskId,
    module_id: run.moduleId,
    agent: run.agent,
    scope: run.scope as RunRecord["scope"],
    launch_state: run.launchState,
    launch_model: run.launchModel,
    started_at: run.startedAt ?? undefined,
    state: run.state as RunRecord["state"],
    effective_state: run.effectiveState as RunRecord["effective_state"],
    updated_at: run.updatedAt,
    exit_code: run.exitCode,
    output_sequence: run.outputSequence,
    last_output_at: run.lastOutputAt,
  };
}

function cacheAttempt(attempt: AutomationAttemptRecord): CachedAttempt {
  return {
    __typename: "AutomationAttemptStatus",
    rootAttemptId: attempt.root_attempt_id,
    attemptId: attempt.attempt_id,
    retryOfAttemptId: attempt.retry_of_attempt_id,
    workItemId: attempt.work_item_id,
    status: attempt.status,
    error: attempt.error,
    failure: attempt.failure,
    retryable: attempt.retryable,
    agentRunId: attempt.agent_run_id,
    updatedAt: attempt.updated_at,
  };
}

function attemptRecord(attempt: CachedAttempt): AutomationAttemptRecord {
  return {
    attempt_id: attempt.attemptId,
    root_attempt_id: attempt.rootAttemptId,
    retry_of_attempt_id: attempt.retryOfAttemptId,
    work_item_id: attempt.workItemId,
    status: attempt.status as AutomationAttemptRecord["status"],
    error: attempt.error,
    failure: attempt.failure,
    retryable: attempt.retryable,
    agent_run_id: attempt.agentRunId,
    updated_at: attempt.updatedAt,
  };
}

function writeHolding(holding: CachedHolding): void {
  const client = studioApolloClient();
  client.cache.writeQuery<HoldingQueryData>({
    query: ActiveProjectRunStatusDocument,
    data: { activeProjectRunStatus: holding },
  });
  client.cache.gc();
}

function writeRun(run: RunRecord): void {
  const client = studioApolloClient();
  client.cache.writeFragment<CachedRun>({
    id: client.cache.identify({ __typename: "AgentRuns", id: run.agent_run_id }),
    fragment: AgentRunStatusFragment,
    data: cacheRun(run),
  });
}

function readCachedHolding(): CachedHolding | null {
  return studioApolloClient().cache.readQuery<HoldingQueryData>({
    query: ActiveProjectRunStatusDocument,
  })?.activeProjectRunStatus ?? null;
}

export function readAgentStatusHolding(): AgentStatusData {
  const holding = readCachedHolding();
  if (!holding) return EMPTY_HOLDING;
  if (holding === lastCachedHolding) return lastHolding;
  const runs = Object.fromEntries(
    holding.runs.map((run) => [run.id, runRecord(run)]),
  );
  const attempts = holding.automationAttempts.map(attemptRecord);
  lastCachedHolding = holding;
  lastHolding = {
    projectId: holding.projectId,
    runs,
    automationAttempts: Object.fromEntries(
      attempts.map((attempt) => [attempt.root_attempt_id, attempt]),
    ),
    automationByTask: attempts.reduce<Record<string, string[]>>(
      (byTask, attempt) => {
        const roots = byTask[attempt.work_item_id] ?? [];
        if (!roots.includes(attempt.root_attempt_id)) {
          byTask[attempt.work_item_id] = [...roots, attempt.root_attempt_id];
        }
        return byTask;
      },
      {},
    ),
    stallEpoch: holding.stallEpoch,
  };
  return lastHolding;
}

export function subscribeAgentStatusHolding(onChange: () => void): () => void {
  return studioApolloClient().cache.watch({
    query: ActiveProjectRunStatusDocument,
    optimistic: true,
    callback: onChange,
  });
}

export function switchAgentStatusProject(projectId: string): void {
  if (readCachedHolding()?.projectId === projectId) return;
  writeHolding({
    __typename: "ProjectRunStatus",
    projectId,
    stallEpoch: 0,
    runs: [],
    automationAttempts: [],
  });
}

export function replaceAgentStatusSnapshot(
  projectId: string,
  runs: readonly RunRecord[],
  attempts: readonly AutomationAttemptRecord[],
): boolean {
  const current = readCachedHolding();
  if (!current || current.projectId !== projectId) return false;
  writeHolding({
    __typename: "ProjectRunStatus",
    projectId,
    stallEpoch: current.stallEpoch,
    runs: runs.map(cacheRun),
    automationAttempts: attempts.map(cacheAttempt),
  });
  return true;
}

function stateSupersedes(
  current: RunRecord,
  state: RunRecord["state"],
  at: string,
): boolean {
  const comparison = Date.parse(at) - Date.parse(current.updated_at);
  if (comparison !== 0) return comparison > 0;
  return isTerminalOutcome(state) && !isTerminalOutcome(current.state);
}

function incomingRunSupersedes(
  current: RunRecord,
  incoming: RunRecord,
): boolean {
  const comparison = Date.parse(incoming.updated_at) - Date.parse(current.updated_at);
  if (comparison !== 0) return comparison > 0;
  return isTerminalOutcome(incoming.state) && !isTerminalOutcome(current.state);
}

export function applyAgentRunState(
  runId: string,
  state: RunRecord["state"],
  at: string,
  exitCode?: number | null,
  effectiveState?: RunRecord["effective_state"],
): boolean {
  const run = readAgentStatusHolding().runs[runId];
  if (!run) return false;
  if (!stateSupersedes(run, state, at)) return true;
  writeRun({
    ...run,
    state,
    effective_state: effectiveState ?? state,
    updated_at: at,
    exit_code: exitCode ?? run.exit_code ?? null,
  });
  return true;
}

export function applyAgentRunActivity(incoming: RunRecord): boolean {
  const current = readAgentStatusHolding().runs[incoming.agent_run_id];
  if (!current) return false;
  if (isTerminalOutcome(current.state)) return true;
  if ((incoming.output_sequence ?? 0) <= (current.output_sequence ?? 0)) {
    return true;
  }
  writeRun({
    ...current,
    effective_state: incoming.effective_state,
    output_sequence: incoming.output_sequence,
    last_output_at: incoming.last_output_at,
  });
  return true;
}

export function upsertAgentRun(incoming: RunRecord): void {
  const current = readCachedHolding();
  if (!current) {
    const projectId = incoming.project_id ?? "";
    switchAgentStatusProject(projectId);
    replaceAgentStatusSnapshot(projectId, [incoming], []);
    return;
  }
  const held = readAgentStatusHolding().runs[incoming.agent_run_id];
  if (held && !incomingRunSupersedes(held, incoming)) {
    if (
      !isTerminalOutcome(held.state) &&
      (incoming.output_sequence ?? 0) > (held.output_sequence ?? 0)
    ) {
      applyAgentRunActivity(incoming);
    }
    return;
  }
  const merged = held && (incoming.output_sequence ?? 0) < (held.output_sequence ?? 0)
    ? {
        ...incoming,
        effective_state: incoming.state,
        output_sequence: held.output_sequence,
        last_output_at: held.last_output_at,
      }
    : incoming;
  if (held) {
    writeRun(merged);
    return;
  }
  writeHolding({
    ...current,
    runs: [...current.runs, cacheRun(merged)],
  });
}

export function upsertAutomationAttempt(
  attempt: AutomationAttemptRecord,
): void {
  const current = readCachedHolding();
  if (!current) return;
  const remaining = current.automationAttempts.filter(
    (held) => held.rootAttemptId !== attempt.root_attempt_id,
  );
  writeHolding({
    ...current,
    automationAttempts: [...remaining, cacheAttempt(attempt)],
  });
}

export function markStalledAgentRuns(now: number = Date.now()): void {
  for (const run of Object.values(readAgentStatusHolding().runs)) {
    if (isTerminalOutcome(run.state) || isAwaitingUser(run.state)) continue;
    const deadline = stallDeadlineAt(run);
    if (deadline === null || deadline > now || run.effective_state === "stalled") {
      continue;
    }
    writeRun({ ...run, effective_state: "stalled" });
  }
}

export function replaceAgentStatusHolding(data: AgentStatusData): void {
  const client = studioApolloClient();
  if (data.projectId === null) {
    client.cache.writeQuery<HoldingQueryData>({
      query: ActiveProjectRunStatusDocument,
      data: { activeProjectRunStatus: null },
    });
    client.cache.gc();
    return;
  }
  writeHolding({
    __typename: "ProjectRunStatus",
    projectId: data.projectId,
    stallEpoch: data.stallEpoch,
    runs: Object.values(data.runs).map(cacheRun),
    automationAttempts: Object.values(data.automationAttempts).map(cacheAttempt),
  });
}

export function advanceAgentStatusStallEpoch(): void {
  const current = readCachedHolding();
  if (!current) return;
  writeHolding({ ...current, stallEpoch: current.stallEpoch + 1 });
}

export function pruneAgentRuns(olderThan: string): void {
  const current = readAgentStatusHolding();
  if (!current.projectId) return;
  const cutoff = Date.parse(olderThan);
  replaceAgentStatusHolding({
    ...current,
    runs: Object.fromEntries(Object.entries(current.runs).filter(([, run]) =>
      !isTerminalOutcome(run.state) || Date.parse(run.updated_at) >= cutoff
    )),
  });
}
