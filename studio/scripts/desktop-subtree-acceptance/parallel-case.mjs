import { openExistingStory } from "../desktop-studio-ui.mjs";
import { observeCampaign } from "./campaign-observer.mjs";
import { parallelLaunchViolations } from "./parallel-launch.mjs";
import { dependencyGraphStates, graphRunHolding } from "./persisted-facts.mjs";
import { expectVisibleChildState, pressRunSubtree, waitForOpenSubtreeRun, waitForRestoredControls } from "./subtree-controls.mjs";

// Many acceptance reconciliation passes (the sweep runs every 250 ms).
const SETTLE_MILLIS = 3_000;

/**
 * Case: parallel (core only). One press of **Run subtree** launches every
 * eligible direct child concurrently: with every stub held, all children
 * start, each with its own agent run and live private tmux session, before
 * any is released. Released, each reaches `Review`, every run and session
 * ends and the controls return. No duplicate or orphan exists at any sample.
 *
 * Launch claims have no public read, so one claim per child is proven
 * through what each claim binds: exactly one start record and one agent run
 * per child, and no second start through a settle window.
 */
export async function runParallelCase({ installation, stubs, fixture, campaign }) {
  const { browser, dataDirectory } = installation;
  const { root, children } = campaign;
  const childIds = children.map((child) => child.id);
  const observer = observeCampaign({ installation, stubs, projectId: fixture.project.id, root, children });
  const childStarts = (current) => current.startRecords.filter((record) => childIds.includes(record.work_item_id));
  const completions = () => stubs.startRecords().map((record) => stubs.completionRecord(record.agent_run_id)).filter(Boolean);
  const concurrency = (current) => parallelLaunchViolations({
    childIds,
    startRecords: childStarts(current),
    completionRecords: completions(),
    runs: current.runs,
    tmuxSessions: current.tmuxSessions,
  });

  await openExistingStory(browser, root.id);
  await observer.expectConsistent();
  await pressRunSubtree(browser);
  const holding = await graphRunHolding(browser, root.id);
  if (holding?.execution_mode !== "parallel") {
    throw new Error(`the press persisted ${JSON.stringify(holding)}, not a parallel graph run`);
  }
  const badge = await waitForOpenSubtreeRun(browser);
  console.log(`Parallel subtree run started; Open subtree run shows "${badge}".`);

  // Every stub is still held: nothing has been released yet.
  let lastViolations = [];
  const live = await observer.waitFor((current) => {
    lastViolations = concurrency(current);
    return lastViolations.length === 0 && current;
  }, "every child to be live at once", { timeoutMillis: 60_000 }).catch((error) => {
    throw new Error(`${error.message}: ${lastViolations.join("; ")}`);
  });
  if (completions().some((completion) => childIds.includes(stubs.startRecord(completion.agent_run_id)?.work_item_id))) {
    throw new Error("a held stub completed before release");
  }
  const starts = childStarts(live);
  const sessions = live.tmuxSessions.filter((session) => starts.some((record) => record.agent_run_id === session.agentRunId));
  console.log(`All ${children.length} children live at once: runs ${starts.map((record) => record.agent_run_id).join(", ")}; `
    + `sessions ${sessions.map((session) => session.session).join(", ")}.`);
  await observer.settle(SETTLE_MILLIS, (current) => childStarts(current).length !== children.length
    && `${childStarts(current).length} child starts`, "a child started again while every child was live");
  await observer.expectConsistent();

  for (const record of starts) stubs.release(record.agent_run_id);
  for (const record of starts) await stubs.waitForCompletion(record.agent_run_id, { timeoutMillis: 60_000 });
  await observer.waitFor(async () => {
    const states = await dependencyGraphStates(dataDirectory, root.id);
    return childIds.every((id) => states[id] === "Review");
  }, "every child to persist Review");
  await observer.waitFor((current) => starts.every((record) => {
    const run = current.runs.find((candidate) => candidate.agentRunId === record.agent_run_id);
    return run && !run.unfinished && !current.tmuxSessions.some((session) => session.agentRunId === record.agent_run_id);
  }), "every child's run to end and its tmux session to disappear");
  for (const child of children) await expectVisibleChildState(browser, { root, child, state: "Review" });

  await observer.settle(SETTLE_MILLIS, (current) => childStarts(current).length !== children.length
    && `${childStarts(current).length} child starts`, "a child started after the campaign finished");
  await waitForRestoredControls(browser, { controls: ["Run subtree serially", "Run subtree"] });
  await installation.waitForTmuxEmpty();
  await observer.expectConsistent({ final: true });
  console.log(`Parallel case passed: ${children.length} children ran concurrently, one run and one session each.`);
}
