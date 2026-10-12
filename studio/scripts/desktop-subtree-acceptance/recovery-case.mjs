import { setTimeout as delay } from "node:timers/promises";

import { openExistingStory } from "../desktop-studio-ui.mjs";
import { monotonicNow } from "../desktop-subtree-stub/run-records.mjs";
import { isAlive, observeCampaign } from "./campaign-observer.mjs";
import { parseTmuxAgentSessions } from "./campaign-integrity.mjs";
import { dependencyGraphStates, graphRunHolding } from "./persisted-facts.mjs";
import { agentSessionEnded, reAdoptionViolations, successfulMcpCallAfter } from "./recovery-checks.mjs";
import { serialOrderViolations } from "./serial-order.mjs";
import {
  expectVisibleChildState,
  pressRunSubtreeSerially,
  waitForOpenSubtreeRun,
  waitForRestoredControls,
} from "./subtree-controls.mjs";

// Many acceptance reconciliation passes (the sweep runs every 250 ms).
const SETTLE_MILLIS = 3_000;

/**
 * Case: recovery (both editions). A serial campaign survives a SIGKILL while
 * child 1 is live and an orderly quit while child 2's advancement is owed:
 *
 * 1. After the crash and restart, child 1 keeps its run and tmux session, no
 *    child starts again, **Open subtree run** returns and the re-adopted
 *    stub's MCP call succeeds through its bridge.
 * 2. Child 2 moves to `Review` but stays live; Ticketry quits, the stub exits
 *    while Ticketry is down, and the next start ends child 2's run and starts
 *    child 3 exactly once.
 * 3. Child 3 finishes and the campaign ends with one run per child and
 *    nothing left alive.
 *
 * The WebDriver session changes on every restart, so this case always reads
 * `installation.browser` afresh. The in-flight orphan check runs after each
 * restart.
 */
export async function runRecoveryCase({ installation, stubs, fixture, campaign }) {
  const { dataDirectory } = installation;
  const { root, children } = campaign;
  const [first, second, third] = children;
  const observer = observeCampaign({ installation, stubs, projectId: fixture.project.id, root, children });
  const starts = (current) => current.startRecords;
  const startCount = (count, description) => (current) => starts(current).length !== count
    && `${description}: ${starts(current).map((record) => record.work_item_id).join(", ")}`;
  const waitForStart = (child, index) => observer.waitFor((current) => {
    if (starts(current).length > index + 1) {
      throw new Error(`expected exactly ${index + 1} starts when ${child.name} started, saw ${starts(current).length}`);
    }
    const record = starts(current)[index];
    if (record && record.work_item_id !== child.id) {
      throw new Error(`start ${index + 1} was ${record.work_item_id}, expected ${child.name}`);
    }
    return record;
  }, `${child.name} to start`);

  async function waitForChildFinished(child, start) {
    await observer.waitFor(async () => (await dependencyGraphStates(dataDirectory, root.id))[child.id] === "Review",
      `${child.name} to persist Review`);
    await observer.waitFor((current) => {
      const run = current.runs.find((candidate) => candidate.agentRunId === start.agent_run_id);
      return run && !run.unfinished && !current.tmuxSessions.some((session) => session.agentRunId === start.agent_run_id);
    }, `${child.name}'s run to end and its tmux session to disappear`);
    await expectVisibleChildState(installation.browser, { root, child, state: "Review" });
  }

  await openExistingStory(installation.browser, root.id);
  await observer.expectConsistent();
  await pressRunSubtreeSerially(installation.browser);
  const holding = await graphRunHolding(installation.browser, root.id);
  if (holding?.execution_mode !== "serial") throw new Error(`the press persisted ${JSON.stringify(holding)}, not a serial graph run`);
  await waitForOpenSubtreeRun(installation.browser);

  // 1. Crash while child 1 is live.
  const firstStart = await waitForStart(first, 0);
  await observer.settle(SETTLE_MILLIS, startCount(1, "another child started while child 1 was live"), "before the crash");
  const beforeCrash = { ...await observer.expectConsistent(), tmuxInventory: installation.tmuxInventory() };
  await installation.killHard();
  if (installation.tmuxInventory() !== beforeCrash.tmuxInventory) {
    throw new Error(`the SIGKILL changed the private tmux inventory: ${installation.tmuxInventory().trim()}`);
  }
  const restartedAt = monotonicNow();
  await installation.restart();
  await observer.expectConsistent();
  await observer.settle(SETTLE_MILLIS, startCount(1, "a child started again after the crash"), "after the crash restart");
  const crashViolations = reAdoptionViolations({
    childId: first.id,
    before: beforeCrash,
    after: { ...await observer.sample(), tmuxInventory: installation.tmuxInventory() },
  });
  if (crashViolations.length > 0) throw new Error(`the crash restart did not re-adopt ${first.name}: ${crashViolations.join("; ")}`);
  await openExistingStory(installation.browser, root.id);
  const badge = await waitForOpenSubtreeRun(installation.browser);
  console.log(`After SIGKILL, ${first.name} kept run ${firstStart.agent_run_id}; Open subtree run shows "${badge}".`);

  stubs.release(firstStart.agent_run_id);
  await stubs.waitForCompletion(firstStart.agent_run_id, { timeoutMillis: 120_000 });
  const recoveredCall = successfulMcpCallAfter(stubs.mcpResponses(firstStart.agent_run_id), restartedAt);
  if (!recoveredCall) throw new Error(`${first.name}'s stub made no successful MCP call through its bridge after the restart`);
  await waitForChildFinished(first, firstStart);

  // 2. Orderly quit while child 2's advancement is owed.
  const secondStart = await waitForStart(second, 1);
  stubs.release(secondStart.agent_run_id, { exitAfterMove: true });
  await stubs.waitForMove(secondStart.agent_run_id, { timeoutMillis: 60_000 });
  await observer.waitFor(async () => (await dependencyGraphStates(dataDirectory, root.id))[second.id] === "Review",
    `${second.name} to persist Review`);
  await expectVisibleChildState(installation.browser, { root, child: second, state: "Review" });
  // Moved but still live: the serial frontier holds child 3 back.
  await observer.settle(SETTLE_MILLIS, startCount(2, "child 3 started while child 2's run was live"), "before the quit");
  await observer.expectConsistent();
  await installation.quitOrderly();
  stubs.signalExit(secondStart.agent_run_id);
  const secondCompletion = await stubs.waitForCompletion(secondStart.agent_run_id, { timeoutMillis: 60_000 });
  const secondPids = [secondStart.pid, ...secondCompletion.bridge_pids];
  await waitWhileTicketryIsDown(() => !secondPids.some(isAlive)
    && agentSessionEnded(parseTmuxAgentSessions(installation.tmuxInventory()), secondStart.agent_run_id),
  `${second.name}'s stub, bridge and tmux pane to end while Ticketry is down`);
  await installation.restart();
  await observer.expectConsistent();
  await waitForChildFinished(second, secondStart);
  const thirdStart = await waitForStart(third, 2);
  await observer.settle(SETTLE_MILLIS, startCount(3, "a child started again after the quit restart"), "after the quit restart");
  await observer.expectConsistent();
  console.log(`After the orderly quit, ${second.name}'s run ended and ${third.name} started once.`);

  // 3. Finish the campaign.
  await openExistingStory(installation.browser, root.id);
  stubs.release(thirdStart.agent_run_id);
  await stubs.waitForCompletion(thirdStart.agent_run_id, { timeoutMillis: 60_000 });
  await waitForChildFinished(third, thirdStart);
  await observer.settle(SETTLE_MILLIS, startCount(3, "a child started after the campaign finished"), "after the campaign");
  await waitForRestoredControls(installation.browser);

  const startRecords = stubs.startRecords().filter((record) => children.some((child) => child.id === record.work_item_id));
  const ordering = serialOrderViolations({
    orderedChildIds: children.map((child) => child.id),
    startRecords,
    completionRecords: startRecords.map((record) => stubs.completionRecord(record.agent_run_id)).filter(Boolean),
  });
  if (ordering.length > 0) throw new Error(`serial ordering failed across the restarts: ${ordering.join("; ")}`);
  await installation.waitForTmuxEmpty();
  await observer.expectConsistent({ final: true });
  console.log(`Recovery case passed: the campaign survived a SIGKILL and an orderly quit with one run per child.`);
}

// No product read answers while Ticketry is down, so this polls local facts only.
async function waitWhileTicketryIsDown(check, description, timeoutMillis = 30_000) {
  const deadline = Date.now() + timeoutMillis;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
    await delay(100);
  }
}
