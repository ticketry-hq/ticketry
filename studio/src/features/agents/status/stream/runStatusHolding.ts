import type { RunStatusEventFrame } from "../types";
import {
  applyAgentRunActivity,
  applyAgentRunState,
  upsertAgentRun,
} from "../apolloHolding";
import { readStatusFact, type StatusFact } from "./statusFacts";
import {
  settleTerminalHolding,
} from "./terminalInvalidation";

export type RunStatusApplyResult = "applied" | "unknown_run" | "not_run_fact";

export function applyRunStatusFact(fact: StatusFact | null): RunStatusApplyResult {
  if (fact?.family !== "agent_run" && fact?.family !== "agent_run_activity") {
    return "not_run_fact";
  }
  if (fact.family === "agent_run_activity") {
    if (!applyAgentRunActivity(fact.run)) return "unknown_run";
    return "applied";
  }
  if (fact.run) upsertAgentRun(fact.run);
  if (!applyAgentRunState(
    fact.agentRunId,
    fact.state,
    fact.occurredAt,
    fact.exitCode,
    fact.effectiveState,
  )) return "unknown_run";
  if (fact.terminalOutcome) settleTerminalHolding(fact.agentRunId);
  return "applied";
}

export function applyRunStatusFrame(frame: RunStatusEventFrame): RunStatusApplyResult {
  return applyRunStatusFact(readStatusFact(frame));
}
