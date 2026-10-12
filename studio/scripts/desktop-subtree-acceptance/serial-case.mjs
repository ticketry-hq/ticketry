import { openExistingStory } from "../desktop-studio-ui.mjs";
import { observeCampaign } from "./campaign-observer.mjs";
import { dependencyGraphStates, graphRunHolding } from "./persisted-facts.mjs";
import { serialOrderViolations } from "./serial-order.mjs";
import {
  assertParallelControlAbsent,
  expectVisibleChildState,
  focusSubtreeRunTerminal,
  pressRunSubtreeSerially,
  waitForOpenSubtreeRun,
  waitForRestoredControls,
} from "./subtree-controls.mjs";

// Many acceptance reconciliation passes (the sweep runs every 250 ms).
const SETTLE_MILLIS = 3_000;

/**
 * Case: serial. One press of **Run subtree serially** runs every child one at
 * a time in stored sequence order, advancing automatically: each child starts
 * only after the previous child reached `Review` and its run and terminal
 * ended. No duplicate or orphaned agent exists at any sample.
 */
export async function runSerialCase({ installation, stubs, fixture, campaign, edition }) {
  const { browser, dataDirectory } = installation;
  const { root, children } = campaign;
  const observer = observeCampaign({ installation, stubs, projectId: fixture.project.id, root, children });
  const startsFor = (current) => current.startRecords;

  await openExistingStory(browser, root.id);
  if (edition === "pocock") await assertParallelControlAbsent(browser);
  await observer.expectConsistent();
  await pressRunSubtreeSerially(browser);
  const holding = await graphRunHolding(browser, root.id);
  if (holding?.execution_mode !== "serial") {
    throw new Error(`the press persisted ${JSON.stringify(holding)}, not a serial graph run`);
  }
  const badge = await waitForOpenSubtreeRun(browser);
  console.log(`Serial subtree run started; Open subtree run shows "${badge}".`);

  for (const [index, child] of children.entries()) {
    const start = await observer.waitFor(
      (current) => startsFor(current).length > index && startsFor(current)[index],
      `child ${index + 1} (${child.name}) to start`,
    );
    if (start.work_item_id !== child.id || startsFor(await observer.sample()).length !== index + 1) {
      throw new Error(`start ${index + 1} was ${start.work_item_id}, expected exactly one start for ${child.id}`);
    }
    await observer.settle(SETTLE_MILLIS, (current) => startsFor(current).length !== index + 1
      && startsFor(current).slice(index + 1).map((record) => record.work_item_id),
      `another child started while ${child.name} was live`);
    await observer.expectConsistent();

    if (index === 0) {
      await focusSubtreeRunTerminal(browser, child);
      await openExistingStory(browser, root.id);
    }

    stubs.release(start.agent_run_id);
    await stubs.waitForCompletion(start.agent_run_id, { timeoutMillis: 60_000 });
    await observer.waitFor(async () => {
      const states = await dependencyGraphStates(dataDirectory, root.id);
      return states[child.id] === "Review";
    }, `${child.name} to persist Review`);
    await observer.waitFor((current) => {
      const run = current.runs.find((candidate) => candidate.agentRunId === start.agent_run_id);
      return run && !run.unfinished
        && !current.tmuxSessions.some((session) => session.agentRunId === start.agent_run_id);
    }, `${child.name}'s run to end and its tmux session to disappear`);
    await expectVisibleChildState(browser, { root, child, state: "Review" });
  }

  await observer.settle(SETTLE_MILLIS, (current) => startsFor(current).length !== children.length
    && `${startsFor(current).length} starts`, "a child started after the campaign finished");
  await waitForRestoredControls(browser);
  const states = await dependencyGraphStates(dataDirectory, root.id);
  const unfinished = children.filter((child) => states[child.id] !== "Review");
  if (unfinished.length > 0) throw new Error(`children not in Review at case end: ${unfinished.map((child) => child.name).join(", ")}`);

  const startRecords = stubs.startRecords().filter((record) => children.some((child) => child.id === record.work_item_id));
  const ordering = serialOrderViolations({
    orderedChildIds: children.map((child) => child.id),
    startRecords,
    completionRecords: startRecords.map((record) => stubs.completionRecord(record.agent_run_id)).filter(Boolean),
  });
  if (ordering.length > 0) throw new Error(`serial ordering failed: ${ordering.join("; ")}`);
  await installation.waitForTmuxEmpty();
  await observer.expectConsistent({ final: true });
  console.log(`Serial case passed: ${children.length} children ran one at a time in stored sequence order.`);
}
