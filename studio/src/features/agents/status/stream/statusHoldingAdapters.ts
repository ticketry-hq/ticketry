/**
 * Caller-shaped adapters for the published status projections.
 *
 * The generated payloads are the contract; the holding keeps its own record
 * shapes. Converting once, here, keeps the rest of the consumer free of
 * generated types and gives the typed failure detail one place to be narrowed.
 */
import type { AutomationAttemptPayload } from "../generated/attempts";
import type { RunHoldingPayload } from "../generated/statusStream";
import type {
  AgentRunScope,
  AutomationAttemptRecord,
  RawLifecycleState,
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
    status: payload.status,
    error: payload.error,
    failure: toAttemptFailure(payload.failure),
    retryable: payload.retryable,
    agent_run_id: payload.agent_run_id,
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
    started_at: payload.started_at,
    state: payload.state as RawLifecycleState,
    updated_at: payload.updated_at,
  };
}
