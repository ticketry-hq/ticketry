import assert from "node:assert/strict";
import test from "node:test";

import { campaignIntegrityViolations, parseTmuxAgentSessions } from "./campaign-integrity.mjs";
import { assertRunningEdition, casesForEdition, editionFromMcpTools } from "./edition-cases.mjs";
import { parallelLaunchViolations } from "./parallel-launch.mjs";
import { serialOrderViolations } from "./serial-order.mjs";

const SPRINT_TOOLS = ["list_sprints", "get_sprint_goals", "suggest_sprint_story"];
const COMMON_TOOLS = ["mcp_ping", "get_dependency_graph", "update_task_status"];

test("the running edition is read from the edition-filtered global MCP tool list", () => {
  assert.equal(editionFromMcpTools([...COMMON_TOOLS, ...SPRINT_TOOLS]), "core");
  assert.equal(editionFromMcpTools(COMMON_TOOLS), "pocock");
  assert.throws(() => editionFromMcpTools([...COMMON_TOOLS, "list_sprints"]), /partial sprint tool set/);
});

test("a running app of another edition fails before any case", () => {
  assert.equal(assertRunningEdition("pocock", { runtimeEdition: "pocock", toolNames: COMMON_TOOLS }), "pocock");
  assert.throws(
    () => assertRunningEdition("pocock", { runtimeEdition: "pocock", toolNames: [...COMMON_TOOLS, ...SPRINT_TOOLS] }),
    /requested the pocock edition but the running app's MCP tool list is core/,
  );
  assert.throws(
    () => assertRunningEdition("core", { runtimeEdition: "pocock", toolNames: [...COMMON_TOOLS, ...SPRINT_TOOLS] }),
    /requested the core edition but the running app's runtime configuration is pocock/,
  );
});

test("an app that reports no edition in its runtime configuration is judged by its tools alone", () => {
  assert.equal(assertRunningEdition("pocock", { runtimeEdition: undefined, toolNames: COMMON_TOOLS }), "pocock");
  assert.throws(
    () => assertRunningEdition("core", { runtimeEdition: undefined, toolNames: COMMON_TOOLS }),
    /requested the core edition but the running app's MCP tool list is pocock/,
  );
});

test("each edition runs a fixed case list", () => {
  assert.deepEqual(casesForEdition("pocock"), ["serial", "recovery"]);
  assert.deepEqual(casesForEdition("core"), ["serial", "parallel", "recovery"]);
  assert.throws(() => casesForEdition("full"), /unknown edition/);
});

test("private tmux inventory lines become agent sessions keyed by run id", () => {
  const inventory = [
    "ticketry-a|run-1|0||node|codex",
    "ticketry-shell||0||zsh|zsh",
    "",
  ].join("\n");
  assert.deepEqual(parseTmuxAgentSessions(inventory), [
    { session: "ticketry-a", agentRunId: "run-1", paneDead: false },
    { session: "ticketry-shell", agentRunId: null, paneDead: false },
  ]);
  assert.deepEqual(parseTmuxAgentSessions("<no private tmux sessions>\n"), []);
});

const start = (child, run) => ({ work_item_id: child, agent_run_id: run, pid: 1, bridge_pid: 2, monotonic_ns: "1" });

test("one live child with its own run and session is consistent", () => {
  const violations = campaignIntegrityViolations({
    rootId: "root",
    childIds: ["a", "b"],
    startRecords: [start("a", "run-a")],
    runs: [{ workItemId: "a", agentRunId: "run-a", unfinished: true }],
    tmuxSessions: [{ session: "s-a", agentRunId: "run-a", paneDead: false }],
  });
  assert.deepEqual(violations, []);
});

test("two unfinished runs for one work item and a second start are duplicates", () => {
  const violations = campaignIntegrityViolations({
    rootId: "root",
    childIds: ["a"],
    startRecords: [start("a", "run-a"), start("a", "run-a2")],
    runs: [
      { workItemId: "a", agentRunId: "run-a", unfinished: true },
      { workItemId: "a", agentRunId: "run-a2", unfinished: true },
    ],
    tmuxSessions: [
      { session: "s-a", agentRunId: "run-a", paneDead: false },
      { session: "s-a2", agentRunId: "run-a2", paneDead: false },
    ],
  });
  assert.deepEqual(violations.map((violation) => violation.kind).sort(), ["duplicate", "duplicate"]);
});

test("a root run, a run without a start record and a start for a non-child are reported", () => {
  const violations = campaignIntegrityViolations({
    rootId: "root",
    childIds: ["a"],
    startRecords: [start("stranger", "run-x")],
    runs: [
      { workItemId: "root", agentRunId: "run-root", unfinished: false },
      { workItemId: "a", agentRunId: "run-a", unfinished: false },
    ],
    tmuxSessions: [],
  });
  assert.deepEqual(violations.map((violation) => violation.message), [
    "the campaign root has agent run run-root",
    "start record for run-x names stranger, which is not a campaign child",
    "child a has 1 agent run(s) but 0 start record(s)",
  ]);
});

test("sessions without unfinished runs and unfinished runs without sessions are orphans", () => {
  const violations = campaignIntegrityViolations({
    rootId: "root",
    childIds: ["a", "b"],
    startRecords: [start("a", "run-a"), start("b", "run-b")],
    runs: [
      { workItemId: "a", agentRunId: "run-a", unfinished: false },
      { workItemId: "b", agentRunId: "run-b", unfinished: true },
    ],
    tmuxSessions: [
      { session: "s-a", agentRunId: "run-a", paneDead: false },
      { session: "s-anon", agentRunId: null, paneDead: false },
    ],
  });
  assert.deepEqual(violations.map((violation) => [violation.kind, violation.message]), [
    ["orphan", "private tmux session s-a (run run-a) has no unfinished claimed run"],
    ["orphan", "private tmux session s-anon (run none) has no unfinished claimed run"],
    ["orphan", "unfinished run run-b for b has no live private tmux session"],
  ]);
});

test("a finished campaign has one run per child and nothing left alive", () => {
  const finished = {
    rootId: "root",
    childIds: ["a", "b"],
    startRecords: [start("a", "run-a"), start("b", "run-b")],
    runs: [
      { workItemId: "a", agentRunId: "run-a", unfinished: false },
      { workItemId: "b", agentRunId: "run-b", unfinished: false },
    ],
    tmuxSessions: [],
    final: true,
    liveHelperPids: [],
  };
  assert.deepEqual(campaignIntegrityViolations(finished), []);
  assert.deepEqual(campaignIntegrityViolations({
    ...finished,
    startRecords: [start("a", "run-a")],
    runs: [{ workItemId: "a", agentRunId: "run-a", unfinished: true }],
    tmuxSessions: [{ session: "s-a", agentRunId: "run-a", paneDead: false }],
    liveHelperPids: [41],
  }).map((violation) => violation.message), [
    "child b has no start record at case end",
    "private tmux session s-a is still alive at case end",
    "agent run run-a is unfinished at case end",
    "stub or bridge process 41 is still alive at case end",
  ]);
});

const timed = (child, startNs, endNs) => ({
  start: { work_item_id: child, agent_run_id: `run-${child}`, monotonic_ns: String(startNs) },
  completion: { work_item_id: child, agent_run_id: `run-${child}`, monotonic_ns: String(endNs) },
});

test("serial starts follow stored sequence and each starts after the previous completion", () => {
  const records = [timed("a", 10, 20), timed("b", 30, 40), timed("c", 50, 60)];
  assert.deepEqual(serialOrderViolations({
    orderedChildIds: ["a", "b", "c"],
    startRecords: records.map((record) => record.start),
    completionRecords: records.map((record) => record.completion),
  }), []);
});

test("an out-of-order or overlapping serial start is reported", () => {
  const records = [timed("a", 10, 40), timed("b", 30, 50)];
  assert.deepEqual(serialOrderViolations({
    orderedChildIds: ["b", "a"],
    startRecords: records.map((record) => record.start),
    completionRecords: records.map((record) => record.completion),
  }), [
    "start 1 was a, expected b in stored sequence order",
    "start 2 was b, expected a in stored sequence order",
    "b started at 30 before a completed at 40",
  ]);
});

test("a serial start compares nanosecond clocks without losing precision", () => {
  const records = [timed("a", 10n, 9007199254740993n), timed("b", 9007199254740992n, 9007199254740999n)];
  assert.deepEqual(serialOrderViolations({
    orderedChildIds: ["a", "b"],
    startRecords: records.map((record) => record.start),
    completionRecords: records.map((record) => record.completion),
  }), ["b started at 9007199254740992 before a completed at 9007199254740993"]);
});

const parallelStart = (child, run, ns) => ({ ...start(child, run), monotonic_ns: String(ns) });
const liveRun = (child, run) => ({ workItemId: child, agentRunId: run, unfinished: true });
const session = (name, run) => ({ session: name, agentRunId: run, paneDead: false });

test("every child live at once with its own run and session is a concurrent launch", () => {
  assert.deepEqual(parallelLaunchViolations({
    childIds: ["a", "b", "c"],
    startRecords: [parallelStart("a", "run-a", 1), parallelStart("b", "run-b", 2), parallelStart("c", "run-c", 3)],
    completionRecords: [],
    runs: [liveRun("a", "run-a"), liveRun("b", "run-b"), liveRun("c", "run-c")],
    tmuxSessions: [session("s-a", "run-a"), session("s-b", "run-b"), session("s-c", "run-c")],
  }), []);
});

test("a child that has not started, or finished before the last start, is not concurrent", () => {
  const violations = parallelLaunchViolations({
    childIds: ["a", "b", "c"],
    startRecords: [parallelStart("a", "run-a", 1), parallelStart("b", "run-b", 5)],
    completionRecords: [{ agent_run_id: "run-a", monotonic_ns: "3" }],
    runs: [liveRun("b", "run-b")],
    tmuxSessions: [session("s-b", "run-b")],
  });
  assert.ok(violations.some((message) => /child c has 0 start records/.test(message)), violations.join("; "));
  assert.ok(violations.some((message) => /run-a completed before every child started/.test(message)), violations.join("; "));
  assert.ok(violations.some((message) => /run-a is not unfinished/.test(message)), violations.join("; "));
});

test("children sharing one run or one tmux session are not distinct agents", () => {
  const violations = parallelLaunchViolations({
    childIds: ["a", "b"],
    startRecords: [parallelStart("a", "run-x", 1), parallelStart("b", "run-x", 2)],
    completionRecords: [],
    runs: [liveRun("a", "run-x")],
    tmuxSessions: [session("s-x", "run-x")],
  });
  assert.ok(violations.some((message) => /2 children share 1 agent run id/.test(message)), violations.join("; "));
  assert.ok(violations.some((message) => /1 distinct live private tmux session/.test(message)), violations.join("; "));
});
