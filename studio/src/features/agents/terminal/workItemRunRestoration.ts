// Ended runs of one WorkItem, restored from the WorkItem read.
//
// The status stream carries live runs only (overhaul-278), so a reopened
// workspace learns about its ended runs here instead. A Story owns its `task`
// runs; a module WorkItem owns the plan, instant, and shell runs of its scratch
// workspace. A run is restorable when it still has a *live* durable terminal
// session record: no record means it never had a terminal to reattach, and a
// record with `terminated_at` set means its tmux session is gone. That live
// record — not a calendar cutoff — is the whole resumability rule.
//
// Rows land on the same `AgentRuns:{id}` cache entity the stream writes, so
// Apollo stays the single owner of run state.
import { useEffect, useMemo } from "react";
import { useQuery } from "@apollo/client/react";

import { studioApolloClient } from "../../../shared/apollo/client";
import { retainRestoredAgentRun } from "../status";
import type { AgentRunScope, RunRecord } from "../status";
import {
  WorkItemEndedRunsDocument,
  type WorkItemEndedRunsQuery,
} from "./generated/workItemRunRestoration.documents";

/** Bounds one WorkItem's restored history; the chip row presents far fewer. */
export const WORK_ITEM_ENDED_RUN_LIMIT = 50;

/** The scopes a module scratch workspace hosts terminals for. */
const SCRATCH_SCOPES: readonly AgentRunScope[] = ["plan", "instant", "shell"];

const EMPTY_RUNS: RunRecord[] = [];

type WorkItemNode = WorkItemEndedRunsQuery["work_item"]["nodes"][number];
type EndedRunNode = WorkItemNode["ended_runs"]["nodes"][number];

/** Where a restored run belongs, which differs by the owner's level. */
type RunPlacement = (item: WorkItemNode) => Pick<RunRecord, "task_id" | "module_id">;

/** A Story owns its own runs; a Story with no module placement is its own module. */
const storyPlacement: RunPlacement = (item) => ({
  task_id: item.id,
  module_id: item.module_id ?? item.id,
});

/** Scratch runs hang off the module itself and belong to no task. */
const scratchPlacement: RunPlacement = (item) => ({
  task_id: null,
  module_id: item.id,
});

/**
 * The terminal state the run projection gives an ended run, matching the
 * backend's `run_holdings_on` mapper so a restored row and a pushed row for the
 * same run cannot disagree.
 */
function endedState(run: EndedRunNode): RunRecord["state"] {
  return run.status === "lost" ? "lost" : "exited";
}

function restorableRun(
  item: WorkItemNode,
  run: EndedRunNode,
  placement: RunPlacement,
): RunRecord | null {
  // Resumability comes from the terminal session record. No record, no durable
  // terminal; a terminated record, no tmux session left to reattach.
  const session = run.terminal_session.nodes.find(
    (candidate) => candidate.agent_run_id === run.agent_run_id,
  );
  if (!session || session.terminated_at !== null) return null;
  return {
    agent_run_id: run.agent_run_id,
    project_id: item.project_id,
    ...placement(item),
    agent: run.agent,
    scope: run.scope as AgentRunScope,
    launch_state: run.launch_state,
    launch_model: run.launch_model,
    provider_session_id: run.provider_session_id,
    started_at: run.started_at,
    state: endedState(run),
    effective_state: endedState(run),
    updated_at: run.ended_at ?? run.started_at,
    exit_code: run.exit_code,
  };
}

function adaptEndedRuns(
  data: WorkItemEndedRunsQuery | undefined,
  placement: RunPlacement,
): RunRecord[] {
  const item = data?.work_item.nodes[0];
  if (!item) return EMPTY_RUNS;
  return item.ended_runs.nodes.flatMap((run) => {
    const record = restorableRun(item, run, placement);
    return record ? [record] : [];
  });
}

/** A Story's read, projected onto the runs its own workspace restores. */
export function adaptStoryEndedRuns(
  data: WorkItemEndedRunsQuery | undefined,
): RunRecord[] {
  return adaptEndedRuns(data, storyPlacement);
}

/** A module's read, projected onto the runs its scratch workspace restores. */
export function adaptScratchEndedRuns(
  data: WorkItemEndedRunsQuery | undefined,
): RunRecord[] {
  return adaptEndedRuns(data, scratchPlacement);
}

function useEndedRuns(
  issueId: string | null,
  issueType: string,
  scopes: readonly AgentRunScope[],
  placement: RunPlacement,
): RunRecord[] {
  const query = useQuery(WorkItemEndedRunsDocument, {
    client: studioApolloClient(),
    variables: {
      issueId: issueId ?? "",
      issueType,
      scopes: scopes as string[],
      limit: WORK_ITEM_ENDED_RUN_LIMIT,
    },
    skip: !issueId,
  });
  const data = issueId ? query.data : undefined;
  // Restoration reruns on identity, so the holding must be stable across
  // renders that changed nothing.
  const runs = useMemo(() => adaptEndedRuns(data, placement), [data, placement]);
  // The read alone leaves the shared entity without the projection's local
  // fields, and reopening a run resolves it from there — so retain them.
  useEffect(() => {
    for (const run of runs) retainRestoredAgentRun(run);
  }, [runs]);
  return runs;
}

/** A Story's exited-but-restorable runs, read through the WorkItem model. */
export function useStoryEndedRuns(taskId: string | null): RunRecord[] {
  return useEndedRuns(taskId, "task", ["task"], storyPlacement);
}

/**
 * A module scratch workspace's exited-but-restorable plan, instant, and shell
 * runs, read through the module WorkItem that owns them.
 */
export function useModuleScratchEndedRuns(moduleId: string | null): RunRecord[] {
  return useEndedRuns(moduleId, "module", SCRATCH_SCOPES, scratchPlacement);
}
