/**
 * Applying one authoritative snapshot to the project holding.
 *
 * This is its own module because the rule it enforces is the one a project
 * switch depends on: the subscription is torn down asynchronously, so a
 * snapshot queued from the project this holding no longer owns must be
 * refused. Reconciling it would mark every run of the newly selected project
 * absent, and therefore exited.
 */
import { replaceAgentStatusSnapshot } from "../apolloHolding";
import type { RunStatusSnapshotFrame } from "../types";
import { toAutomationAttemptRecord, toRunRecord } from "./statusHoldingAdapters";
import { settleTerminalHoldings } from "./terminalInvalidation";

/** Returns true when the snapshot was authoritative for the live project. */
export function applySnapshotFrame(frame: RunStatusSnapshotFrame): boolean {
  const applied = replaceAgentStatusSnapshot(
    frame.project_id,
    frame.runs.map(toRunRecord),
    frame.automation_attempts.map(toAutomationAttemptRecord),
  );
  if (applied) {
    const exitedRunIds = frame.runs
      .filter((run) => run.state === "exited")
      .map((run) => run.agent_run_id);
    if (exitedRunIds.length > 0) settleTerminalHoldings(exitedRunIds);
  }
  return applied;
}
