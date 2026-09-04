/**
 * Caller-shaped adapters for the published status projections.
 *
 * The generated payloads are the contract; the holding keeps its own record
 * shapes. Converting once, here, keeps the rest of the consumer free of
 * generated types and gives the typed failure detail one place to be narrowed.
 */
import type {
  AgentRunScope,
  AutomationAttemptPayload,
  AutomationAttemptRecord,
  RawLifecycleState,
  RunHoldingPayload,
  RunRecord,
} from "../types";

type AttemptFailure = AutomationAttemptRecord["failure"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const string = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * A failure detail is published as JSON, so it is narrowed rather than trusted.
 * A payload without a code is not a usable failure and becomes `null`.
 */
export function toAttemptFailure(value: unknown): AttemptFailure {
  if (!isRecord(value) || typeof value.code !== "string") return null;
  return {
    code: value.code,
    provider: string(value.provider),
    skill: string(value.skill),
    reason: string(value.reason),
    detail: string(value.detail),
    remediation: string(value.remediation),
    retryable: value.retryable === true,
  };
}

export function toAutomationAttemptRecord(
  payload: AutomationAttemptPayload,
): AutomationAttemptRecord {
  return {
    attempt_id: payload.attempt_id,
    root_attempt_id: payload.root_attempt_id,
    retry_of_attempt_id: payload.retry_of_attempt_id,
    work_item_id: payload.work_item_id,
    status: payload.status as AutomationAttemptRecord["status"],
    error: payload.error,
    failure: toAttemptFailure(payload.failure),
    retryable: payload.retryable,
    agent_run_id: payload.agent_run_id,
    delivery_mode: payload.delivery_mode as AutomationAttemptRecord["delivery_mode"],
    updated_at: payload.updated_at,
  };
}

export function toRunRecord(payload: RunHoldingPayload): RunRecord {
  return {
    agent_run_id: payload.agent_run_id,
    project_id: payload.project_id,
    task_id: payload.task_id,
    module_id: payload.module_id,
    agent: payload.agent,
    scope: payload.scope as AgentRunScope,
    launch_state: payload.launch_state,
    launch_model: payload.launch_model,
    provider_session_id: payload.provider_session_id,
    started_at: payload.started_at,
    state: payload.state as RawLifecycleState,
    effective_state: payload.effective_state as RunRecord["effective_state"],
    updated_at: payload.updated_at,
    output_sequence: payload.output_sequence,
    last_output_at: payload.last_output_at,
  };
}
