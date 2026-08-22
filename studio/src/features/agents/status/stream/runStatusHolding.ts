import type { RunStatusEventFrame } from "../generated/statusStream";
import { useAgentStatusStore } from "../store";
import { readStatusFact, type StatusFact } from "./statusFacts";
import { settleTerminalHolding } from "./terminalInvalidation";

export type RunStatusApplyResult = "applied" | "unknown_run" | "not_run_fact";

export function applyRunStatusFact(fact: StatusFact | null): RunStatusApplyResult {
  if (fact?.family !== "agent_run" && fact?.family !== "agent_run_activity") {
    return "not_run_fact";
  }
  const runs = useAgentStatusStore.getState();
  const agentRunId = fact.family === "agent_run" ? fact.agentRunId : fact.run.agent_run_id;
  if (!runs.runs[agentRunId]) return "unknown_run";
  if (fact.family === "agent_run_activity") {
    runs.applyActivity(fact.run);
    return "applied";
  }
  runs.applyState(
    fact.agentRunId,
    fact.state,
    fact.occurredAt,
    fact.exitCode,
    fact.effectiveState,
  );
  if (fact.terminalOutcome) settleTerminalHolding(fact.agentRunId);
  return "applied";
}

export function applyRunStatusFrame(frame: RunStatusEventFrame): RunStatusApplyResult {
  return applyRunStatusFact(readStatusFact(frame));
}
