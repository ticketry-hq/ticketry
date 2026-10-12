/**
 * The parallel case's concurrency proof, pure over facts the case gathers
 * while every stub is still held: each child has exactly one start record,
 * the start records name distinct agent runs, each run is unfinished and
 * owns its own live private tmux session, and no run completed before the
 * last child started. Returns violation messages; empty means concurrent.
 */
export function parallelLaunchViolations({ childIds, startRecords, completionRecords, runs, tmuxSessions }) {
  const violations = [];
  const childStarts = startRecords.filter((record) => childIds.includes(record.work_item_id));
  for (const child of childIds) {
    const starts = childStarts.filter((record) => record.work_item_id === child);
    if (starts.length !== 1) violations.push(`child ${child} has ${starts.length} start records, expected 1`);
  }

  const runIds = [...new Set(childStarts.map((record) => record.agent_run_id))];
  if (runIds.length !== childStarts.length) {
    violations.push(`${childStarts.length} children share ${runIds.length} agent run id(s)`);
  }
  const sessions = new Set(tmuxSessions
    .filter((session) => !session.paneDead && runIds.includes(session.agentRunId))
    .map((session) => session.session));
  if (sessions.size !== childIds.length) {
    violations.push(`${childIds.length} children have ${sessions.size} distinct live private tmux session(s)`);
  }
  for (const runId of runIds) {
    if (!runs.some((run) => run.agentRunId === runId && run.unfinished)) {
      violations.push(`agent run ${runId} is not unfinished in Ticketry while its stub is held`);
    }
    if (!tmuxSessions.some((session) => session.agentRunId === runId && !session.paneDead)) {
      violations.push(`agent run ${runId} has no live private tmux session`);
    }
  }

  const lastStart = childStarts.reduce((latest, record) => {
    const started = BigInt(record.monotonic_ns);
    return started > latest ? started : latest;
  }, 0n);
  for (const completion of completionRecords) {
    if (runIds.includes(completion.agent_run_id) && BigInt(completion.monotonic_ns) <= lastStart) {
      violations.push(`agent run ${completion.agent_run_id} completed before every child started`);
    }
  }
  return violations;
}
