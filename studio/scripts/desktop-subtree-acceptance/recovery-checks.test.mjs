import assert from "node:assert/strict";
import test from "node:test";

import { agentSessionEnded, reAdoptionViolations, successfulMcpCallAfter } from "./recovery-checks.mjs";

const start = (child, run) => ({ work_item_id: child, agent_run_id: run, pid: 1, bridge_pid: 2, monotonic_ns: "1" });
const inventory = "ticketry-run-1|run-1|0||node|codex\n";
const live = {
  startRecords: [start("child-1", "run-1")],
  runs: [{ workItemId: "child-1", agentRunId: "run-1", unfinished: true }],
  tmuxInventory: inventory,
};

test("a crash that keeps the live child's run, session and start record re-adopts it", () => {
  assert.deepEqual(reAdoptionViolations({ childId: "child-1", before: live, after: structuredClone(live) }), []);
});

test("a relaunch after a crash is reported as a new start, a changed run and a changed tmux inventory", () => {
  const relaunched = {
    startRecords: [...live.startRecords, start("child-1", "run-2")],
    runs: [
      { workItemId: "child-1", agentRunId: "run-1", unfinished: false },
      { workItemId: "child-1", agentRunId: "run-2", unfinished: true },
    ],
    tmuxInventory: "ticketry-run-2|run-2|0||node|codex\n",
  };
  assert.deepEqual(reAdoptionViolations({ childId: "child-1", before: live, after: relaunched }), [
    "a new stub start record appeared after the crash: run-2 for child-1",
    "child-1's unfinished run is run-2, not its original run-1",
    "the private tmux inventory changed across the crash: ticketry-run-1|run-1|0||node|codex => ticketry-run-2|run-2|0||node|codex",
  ]);
});

test("a live child whose run ended across the crash is not re-adopted", () => {
  const ended = { ...live, runs: [{ workItemId: "child-1", agentRunId: "run-1", unfinished: false }] };
  assert.deepEqual(reAdoptionViolations({ childId: "child-1", before: live, after: ended }), [
    "child-1's unfinished run is none, not its original run-1",
  ]);
});

const outage = { method: "tools/call", attempt: 1, response: { error: { code: -32001 } }, monotonic_ns: "100" };
const transportFailure = { method: "tools/call", attempt: 2, transport_error: "MCP bridge exited", monotonic_ns: "250" };
const success = (ns) => ({
  method: "tools/call",
  attempt: 3,
  bridge_pid: 7,
  response: { result: { structuredContent: { ok: true }, content: [{ type: "text", text: '{"ok":true}' }] } },
  monotonic_ns: ns,
});

test("a successful tool call recorded after the restart is the stub's recovered MCP call", () => {
  const recovered = success("300");
  assert.equal(successfulMcpCallAfter([outage, transportFailure, recovered], "200"), recovered);
});

test("outage errors, transport failures and successes before the restart are not a recovered call", () => {
  assert.equal(successfulMcpCallAfter([outage, transportFailure, success("150")], "200"), undefined);
  const refused = { ...success("400"), response: { result: { structuredContent: { ok: false }, content: [{ type: "text", text: '{"ok":false}' }] } } };
  assert.equal(successfulMcpCallAfter([refused], "200"), undefined);
});

test("a recovered call compares nanosecond clocks without losing precision", () => {
  assert.equal(successfulMcpCallAfter([success("9007199254740993")], "9007199254740992")?.monotonic_ns, "9007199254740993");
  assert.equal(successfulMcpCallAfter([success("9007199254740992")], "9007199254740992"), undefined);
});

test("an agent session has ended when it is gone or its pane is dead", () => {
  const sessions = [
    { session: "ticketry-run-1", agentRunId: "run-1", paneDead: true },
    { session: "ticketry-run-2", agentRunId: "run-2", paneDead: false },
  ];
  assert.equal(agentSessionEnded(sessions, "run-1"), true);
  assert.equal(agentSessionEnded(sessions, "run-2"), false);
  assert.equal(agentSessionEnded(sessions, "run-3"), true);
});
