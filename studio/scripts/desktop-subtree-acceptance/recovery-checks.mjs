/**
 * Pure checks for the recovery case: whether a crash re-adopted the live
 * child instead of relaunching it, whether a stub's MCP call succeeded after
 * a restart, and whether an agent's tmux session has ended. Callers gather
 * the facts through existing product reads, the private tmux inventory and
 * the stubs' own records.
 */

/**
 * Compares the campaign before a SIGKILL with the campaign after the restart.
 * `before`/`after` are `{ startRecords, runs, tmuxInventory }`. Re-adoption
 * keeps the live child's original run unfinished, adds no start record and
 * leaves the private tmux inventory byte-for-byte unchanged.
 */
export function reAdoptionViolations({ childId, before, after }) {
  const violations = [];
  const original = before.startRecords.find((record) => record.work_item_id === childId);
  if (!original) return [`${childId} had no start record before the crash`];
  for (const record of after.startRecords) {
    if (!before.startRecords.some((earlier) => earlier.agent_run_id === record.agent_run_id)) {
      violations.push(`a new stub start record appeared after the crash: ${record.agent_run_id} for ${record.work_item_id}`);
    }
  }
  const unfinished = after.runs.filter((run) => run.workItemId === childId && run.unfinished).map((run) => run.agentRunId);
  if (unfinished.length !== 1 || unfinished[0] !== original.agent_run_id) {
    violations.push(`${childId}'s unfinished run is ${unfinished.join(", ") || "none"}, not its original ${original.agent_run_id}`);
  }
  if (after.tmuxInventory !== before.tmuxInventory) {
    violations.push(`the private tmux inventory changed across the crash: ${before.tmuxInventory.trim()} => ${after.tmuxInventory.trim()}`);
  }
  return violations;
}

/**
 * The first tool call in a stub's `mcp.jsonl` that Ticketry accepted strictly
 * after `afterNs` on the system-wide monotonic clock, by the stub's own
 * acceptance rule (`"ok":true` in the result).
 */
export function successfulMcpCallAfter(responses, afterNs) {
  return responses.find((entry) => entry.method === "tools/call"
    && BigInt(entry.monotonic_ns) > BigInt(afterNs)
    && entry.response?.result
    && !entry.response.error
    && JSON.stringify(entry.response.result).includes('"ok":true'));
}

/**
 * Ticketry keeps exited panes (`remain-on-exit`), so with Ticketry down an
 * exited agent leaves a dead pane until reconciliation removes the session.
 */
export function agentSessionEnded(tmuxSessions, agentRunId) {
  const session = tmuxSessions.find((candidate) => candidate.agentRunId === agentRunId);
  return !session || session.paneDead;
}
