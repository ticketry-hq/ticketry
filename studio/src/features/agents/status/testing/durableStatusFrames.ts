import type {
  RunHoldingPayload,
  RunStatusEventFrame,
} from "../generated/statusStream";
import type { RawLifecycleState, RunPresentationState } from "../types";
import type { RunRecord } from "../types";

interface EventOptions {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly at: string;
  readonly cursor?: number;
  readonly exitCode?: number | null;
}

function event(
  options: EventOptions,
  eventKind: string,
  payload: Readonly<Record<string, unknown>>,
): RunStatusEventFrame {
  return {
    __typename: "RunStatusEvent",
    cursor: options.cursor ?? 1,
    event_id: `test-event-${options.cursor ?? 1}`,
    project_id: options.projectId,
    event_kind: eventKind,
    payload_version: 1,
    subject_kind: "agent_run",
    subject_id: options.agentRunId,
    agent_run_id: options.agentRunId,
    automation_attempt_id: null,
    work_item_id: null,
    payload,
    committed_at: options.at,
  };
}

export function lifecycleStatusFrame(
  options: EventOptions & {
    readonly state: RawLifecycleState;
    readonly effectiveState?: RunPresentationState;
  },
): RunStatusEventFrame {
  return event(options, "agent_run.lifecycle", {
    agentRunId: options.agentRunId,
    state: options.state,
    effectiveState: options.effectiveState ?? options.state,
    occurredAt: options.at,
    exitCode: options.exitCode ?? null,
  });
}

export function terminalStatusFrame(
  options: EventOptions & {
    readonly state: RawLifecycleState;
    readonly effectiveState?: RunPresentationState;
  },
): RunStatusEventFrame {
  return event(options, "agent_run.terminal", {
    agentRunId: options.agentRunId,
    state: options.state,
    effectiveState: options.effectiveState ?? options.state,
    occurredAt: options.at,
    exitCode: options.exitCode ?? null,
  });
}

export function terminalActivityStatusFrame(
  options: EventOptions & { readonly run: RunHoldingPayload },
): RunStatusEventFrame {
  return event(options, "agent_run.terminal_activity", {
    type: "terminal_activity",
    at: options.at,
    run: options.run,
  });
}

export function statusRunHolding(run: RunRecord): RunHoldingPayload {
  if (!run.project_id || !run.started_at) {
    throw new Error("A durable status test holding requires project and start time.");
  }
  return {
    agent_run_id: run.agent_run_id,
    project_id: run.project_id,
    task_id: run.task_id,
    module_id: run.module_id,
    agent: run.agent ?? null,
    scope: run.scope,
    launch_state: run.launch_state ?? null,
    launch_model: run.launch_model ?? null,
    started_at: run.started_at,
    state: run.state,
    effective_state: run.effective_state ?? run.state,
    updated_at: run.updated_at,
    provider_session_id: null,
    output_sequence: run.output_sequence ?? 0,
    last_output_at: run.last_output_at ?? null,
  };
}
