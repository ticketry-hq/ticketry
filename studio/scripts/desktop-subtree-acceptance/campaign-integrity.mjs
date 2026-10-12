/**
 * The duplicate and orphan rules every subtree case checks, during the
 * campaign and at its end. Pure: callers gather the facts through existing
 * product reads, the private tmux inventory and the stubs' records.
 *
 * - `runs`: `{ workItemId, agentRunId, unfinished }` for the root and every
 *   child, from the live run holdings plus each work item's ended runs.
 * - `tmuxSessions`: `parseTmuxAgentSessions(installation.tmuxInventory())`.
 *
 * A `duplicate` violation is never transient and fails at once; `orphan` and
 * `count` violations may be a reconciliation in flight, so callers retry them
 * before failing.
 */
export function campaignIntegrityViolations({
  rootId,
  childIds,
  startRecords,
  runs,
  tmuxSessions,
  final = false,
  liveHelperPids = [],
}) {
  const violations = [];
  const report = (kind, message) => violations.push({ kind, message });
  const children = new Set(childIds);

  for (const run of runs.filter((candidate) => candidate.workItemId === rootId)) {
    report("count", `the campaign root has agent run ${run.agentRunId}`);
  }
  for (const record of startRecords.filter((candidate) => !children.has(candidate.work_item_id))) {
    report("count", `start record for ${record.agent_run_id} names ${record.work_item_id}, which is not a campaign child`);
  }
  for (const child of childIds) {
    const starts = startRecords.filter((record) => record.work_item_id === child);
    const childRuns = runs.filter((run) => run.workItemId === child);
    if (starts.length > 1) report("duplicate", `child ${child} has ${starts.length} start records`);
    const unfinished = childRuns.filter((run) => run.unfinished);
    if (unfinished.length > 1) report("duplicate", `child ${child} has ${unfinished.length} unfinished agent runs`);
    if (childRuns.length !== starts.length) {
      report("count", `child ${child} has ${childRuns.length} agent run(s) but ${starts.length} start record(s)`);
    } else if (starts.some((record) => !childRuns.some((run) => run.agentRunId === record.agent_run_id))) {
      report("count", `child ${child}'s start records name runs Ticketry does not hold for it`);
    }
    if (final && starts.length === 0) report("count", `child ${child} has no start record at case end`);
  }

  const unfinishedRuns = runs.filter((run) => run.unfinished);
  if (final) {
    for (const session of tmuxSessions) report("orphan", `private tmux session ${session.session} is still alive at case end`);
    for (const run of unfinishedRuns) report("orphan", `agent run ${run.agentRunId} is unfinished at case end`);
    for (const pid of liveHelperPids) report("orphan", `stub or bridge process ${pid} is still alive at case end`);
    return violations;
  }
  for (const session of tmuxSessions) {
    if (!unfinishedRuns.some((run) => run.agentRunId === session.agentRunId)) {
      report("orphan", `private tmux session ${session.session} (run ${session.agentRunId ?? "none"}) has no unfinished claimed run`);
    }
  }
  for (const run of unfinishedRuns) {
    if (!tmuxSessions.some((session) => session.agentRunId === run.agentRunId)) {
      report("orphan", `unfinished run ${run.agentRunId} for ${run.workItemId} has no live private tmux session`);
    }
  }
  return violations;
}

/** `installation.tmuxInventory()` lines as `{ session, agentRunId, paneDead }`. */
export function parseTmuxAgentSessions(inventory) {
  return inventory.split("\n")
    .filter((line) => line && !line.startsWith("<no private tmux"))
    .map((line) => {
      const [session, agentRunId, paneDead] = line.split("|");
      return { session, agentRunId: agentRunId || null, paneDead: paneDead === "1" };
    });
}
