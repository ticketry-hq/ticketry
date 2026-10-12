import { setTimeout as delay } from "node:timers/promises";

import { campaignIntegrityViolations, parseTmuxAgentSessions } from "./campaign-integrity.mjs";
import { workItemRuns } from "./persisted-facts.mjs";

/**
 * Watches one campaign for duplicate and orphan agents, reusable by every
 * subtree case. Each `sample()` gathers persisted runs through existing reads,
 * the private tmux inventory and the stubs' start records; a duplicate seen in
 * any sample fails the case, even if it later disappears. Cases call
 * `sample()` from their own wait loops, so the WebDriver session is never
 * driven concurrently.
 */
export function observeCampaign({ installation, stubs, projectId, root, children }) {
  const childIds = children.map((child) => child.id);
  const seenDuplicates = [];
  const helperPids = new Set();

  async function facts() {
    const startRecords = stubs.startRecords().filter((record) => childIds.includes(record.work_item_id)
      || record.work_item_id === root.id);
    for (const record of stubs.startRecords()) {
      helperPids.add(record.pid);
      helperPids.add(record.bridge_pid);
      for (const pid of stubs.completionRecord(record.agent_run_id)?.bridge_pids ?? []) helperPids.add(pid);
    }
    return {
      rootId: root.id,
      childIds,
      startRecords,
      runs: await workItemRuns(installation.browser, projectId, [root.id, ...childIds]),
      tmuxSessions: parseTmuxAgentSessions(installation.tmuxInventory()),
    };
  }

  async function sample() {
    const current = await facts();
    for (const violation of campaignIntegrityViolations(current)) {
      if (violation.kind === "duplicate" && !seenDuplicates.includes(violation.message)) {
        seenDuplicates.push(violation.message);
      }
    }
    if (seenDuplicates.length > 0) throw new Error(`duplicate agents: ${seenDuplicates.join("; ")}`);
    return current;
  }

  /**
   * Requires a consistent campaign. Orphan and count mismatches can be a
   * reconciliation in flight (a run row before its stub starts, a session
   * just ending), so they are retried for a bounded time before failing.
   */
  async function expectConsistent({ final = false, timeoutMillis = 15_000 } = {}) {
    const deadline = Date.now() + timeoutMillis;
    for (;;) {
      const current = await sample();
      const violations = campaignIntegrityViolations({
        ...current,
        final,
        liveHelperPids: final ? [...helperPids].filter(isAlive) : [],
      });
      if (violations.length === 0) return current;
      if (Date.now() > deadline) {
        throw new Error(`campaign ${final ? "end" : "run"} check failed: ${violations.map((violation) => violation.message).join("; ")}`);
      }
      await delay(250);
    }
  }

  /** Polls `read` until it returns a value, sampling for duplicates each time. */
  async function waitFor(read, description, { timeoutMillis = 60_000, intervalMillis = 250 } = {}) {
    const deadline = Date.now() + timeoutMillis;
    for (;;) {
      const current = await sample();
      const value = await read(current);
      if (value !== undefined && value !== false) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
      await delay(intervalMillis);
    }
  }

  /** Samples for `millis`, failing if `forbidden` ever holds. */
  async function settle(millis, forbidden, description) {
    const deadline = Date.now() + millis;
    while (Date.now() < deadline) {
      const current = await sample();
      const found = await forbidden(current);
      if (found) throw new Error(`${description}: ${typeof found === "string" ? found : JSON.stringify(found)}`);
      await delay(250);
    }
  }

  return { sample, expectConsistent, waitFor, settle, helperPids: () => [...helperPids] };
}

/** Whether a recorded stub or bridge PID is still running. */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
