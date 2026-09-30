/**
 * Applying one authoritative snapshot to the project holding.
 *
 * This is its own module because the rule it enforces is the one a project
 * switch depends on: the subscription is torn down asynchronously, so a
 * snapshot queued from the project this holding no longer owns must be
 * refused. Reconciling it would empty the holding of the newly selected
 * project.
 *
 * The snapshot carries live runs only. "Absent from the snapshot" therefore
 * means "not live", never "exited": a missing run leaves the live holding and
 * its terminal holding is settled, but no exited state is fabricated for it.
 * A run reaches a terminal outcome through its own event, or through the
 * WorkItem read that owns ended runs.
 */
import { readAgentStatusHolding, replaceAgentStatusSnapshot } from "../apolloHolding";
import type { RunStatusSnapshotFrame } from "../types";
import { toAutomationAttemptRecord, toRunRecord } from "./statusHoldingAdapters";
import { settleTerminalHoldings } from "./terminalInvalidation";

/** Returns true when the snapshot was authoritative for the live project. */
export function applySnapshotFrame(frame: RunStatusSnapshotFrame): boolean {
  const held = Object.keys(readAgentStatusHolding().runs);
  const applied = replaceAgentStatusSnapshot(
    frame.project_id,
    frame.runs.map(toRunRecord),
    frame.automation_attempts.map(toAutomationAttemptRecord),
  );
  if (applied) {
    const live = new Set(frame.runs.map((run) => run.agent_run_id));
    const departed = held.filter((runId) => !live.has(runId));
    if (departed.length > 0) settleTerminalHoldings(departed);
  }
  return applied;
}
