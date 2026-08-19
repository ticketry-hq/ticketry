/**
 * Applying one authoritative snapshot to the project holding.
 *
 * This is its own module because the rule it enforces is the one a project
 * switch depends on: the subscription is torn down asynchronously, so a
 * snapshot queued from the project this holding no longer owns must be
 * refused. Reconciling it would mark every run of the newly selected project
 * absent, and therefore exited.
 */
import { useAgentStatusStore } from "../store";
import type { RunStatusSnapshotFrame } from "../generated/statusStream";
import { toAutomationAttemptRecord, toRunRecord } from "./statusHoldingAdapters";

/** Ended runs older than the visibility horizon leave the local holding. */
const EXITED_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

/** Returns true when the snapshot was authoritative for the live project. */
export function applySnapshotFrame(frame: RunStatusSnapshotFrame): boolean {
  const runs = useAgentStatusStore.getState();
  if (runs.projectId !== frame.project_id) return false;
  runs.reconcileScope(
    { project_id: frame.project_id, task_id: null },
    frame.runs.map(toRunRecord),
    frame.at,
  );
  runs.reconcileAutomationAttempts(
    frame.automation_attempts.map(toAutomationAttemptRecord),
  );
  const cutoff = new Date(
    Date.parse(frame.at) - EXITED_RUN_RETENTION_MS,
  ).toISOString();
  runs.pruneRuns(cutoff);
  return true;
}
