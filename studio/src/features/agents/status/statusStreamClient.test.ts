import { describe, expect, it, vi } from "vitest";

import { createStatusStreamClient } from "./statusStreamClient";
import { createStatusCursorStore } from "./statusStreamCursors";
import type { RunStatusFrame } from "./generated/statusStream";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "22222222-2222-2222-2222-222222222222";

function envelope(frame: unknown): string {
  return JSON.stringify({
    type: "next",
    payload: { data: { run_status_stream: frame } },
  });
}

function snapshot(cursor: number, projectId = PROJECT) {
  return {
    __typename: "RunStatusSnapshot",
    project_id: projectId,
    cursor,
    at: "2026-08-16T10:00:00Z",
    runs: [],
    automation_attempts: [],
  };
}

function event(cursor: number, overrides: Record<string, unknown> = {}) {
  return {
    __typename: "RunStatusEvent",
    cursor,
    event_id: `event-${cursor}`,
    project_id: PROJECT,
    event_kind: "agent_run.lifecycle",
    payload_version: 1,
    subject_kind: "agent_run",
    subject_id: "run-a",
    agent_run_id: "run-a",
    automation_attempt_id: null,
    work_item_id: null,
    payload: { state: "working" },
    committed_at: "2026-08-16T10:01:00Z",
    ...overrides,
  };
}

/** A controlled transport: the test drives every frame the server would send. */
function harness(initialCursors: Record<string, number> = {}) {
  const applied: RunStatusFrame[] = [];
  const cursors = createStatusCursorStore(initialCursors);
  let deliver: (encoded: string) => void = () => {};
  let requested: { projectId: string; afterCursor: number | null } | null = null;
  const unsubscribe = vi.fn(async () => true);
  const proxy = {
    graphql_execute: vi.fn(async () => "{}"),
    graphql_subscribe: vi.fn(
      async (_id: string, requestJson: string, onEvent: (value: string) => void) => {
        requested = JSON.parse(requestJson).variables;
        deliver = onEvent;
        return '{"type":"accepted"}';
      },
    ),
    graphql_unsubscribe: unsubscribe,
  };
  const client = createStatusStreamClient({
    projectId: PROJECT,
    subscriptionId: "status-1",
    cursors,
    createProxy: () => proxy,
    handlers: {
      onSnapshot: (frame) => applied.push(frame),
      onEvent: (frame) => applied.push(frame),
      onCaughtUp: (frame) => applied.push(frame),
      onResetRequired: (frame) => applied.push(frame),
      onFailed: (frame) => applied.push(frame),
    },
  });
  return {
    applied,
    cursors,
    client,
    unsubscribe,
    send: (frame: unknown) => deliver(envelope(frame)),
    sendRaw: (encoded: string) => deliver(encoded),
    request: () => requested,
    kinds: () => applied.map((frame) => frame.__typename),
  };
}

describe("the controlled status stream client", () => {
  it("subscribes fresh with no cursor and converges on the authoritative holding", async () => {
    const stream = harness();
    await stream.client.start();

    expect(stream.request()).toEqual({ projectId: PROJECT, afterCursor: null });

    stream.send(snapshot(12));
    stream.send({ __typename: "RunStatusCaughtUp", project_id: PROJECT, cursor: 12 });
    stream.send(event(13));

    expect(stream.kinds()).toEqual([
      "RunStatusSnapshot",
      "RunStatusCaughtUp",
      "RunStatusEvent",
    ]);
    expect(stream.cursors.get(PROJECT)).toBe(13);
  });

  it("resumes from its retained cursor and keeps that cursor monotonic", async () => {
    const stream = harness({ [PROJECT]: 40 });
    await stream.client.start();

    expect(stream.request()).toEqual({ projectId: PROJECT, afterCursor: 40 });

    stream.send(snapshot(44));
    stream.send(event(41));
    stream.send(event(42));
    stream.send({ __typename: "RunStatusCaughtUp", project_id: PROJECT, cursor: 44 });

    expect(stream.kinds()).toEqual([
      "RunStatusSnapshot",
      "RunStatusEvent",
      "RunStatusEvent",
      "RunStatusCaughtUp",
    ]);
    expect(stream.cursors.get(PROJECT)).toBe(44);
  });

  it("ignores duplicate and backwards cursors without disturbing the holding", async () => {
    const stream = harness();
    await stream.client.start();
    stream.send(snapshot(0));
    stream.send({ __typename: "RunStatusCaughtUp", project_id: PROJECT, cursor: 0 });
    stream.send(event(5));

    stream.send(event(5));
    stream.send(event(3));

    expect(stream.applied.filter((frame) => frame.__typename === "RunStatusEvent")).toHaveLength(1);
    expect(stream.cursors.get(PROJECT)).toBe(5);
  });

  it("ignores malformed, unknown, and unsupported frames", async () => {
    const stream = harness();
    await stream.client.start();
    stream.send(snapshot(0));
    stream.send({ __typename: "RunStatusCaughtUp", project_id: PROJECT, cursor: 0 });

    stream.sendRaw("not json at all");
    stream.sendRaw(JSON.stringify({ type: "next", payload: { data: null } }));
    stream.send({ __typename: "RunStatusSomethingNew", project_id: PROJECT, cursor: 9 });
    stream.send({ __typename: "RunStatusEvent", project_id: PROJECT });
    stream.send(event(9, { payload_version: 7 }));

    expect(stream.kinds()).toEqual(["RunStatusSnapshot", "RunStatusCaughtUp"]);
    expect(stream.cursors.get(PROJECT)).toBe(0);
  });

  it("never applies a frame belonging to another project", async () => {
    const stream = harness();
    await stream.client.start();

    stream.send(snapshot(3, OTHER_PROJECT));
    stream.send(event(4, { project_id: OTHER_PROJECT }));

    expect(stream.applied).toHaveLength(0);
    expect(stream.cursors.get(PROJECT)).toBeUndefined();
  });

  it("never installs a reset baseline the caller has not earned", async () => {
    const stream = harness({ [PROJECT]: 2 });
    await stream.client.start();
    stream.send(snapshot(90));

    stream.send({
      __typename: "RunStatusResetRequired",
      project_id: PROJECT,
      cursor: 90,
      reason: "cursor_compacted",
    });
    stream.send(event(91));
    // The caught-up frame of a resetting handshake carries the reset cursor.
    // Installing it here would baseline before the caller's authoritative
    // refresh had a chance to fail.
    stream.send({
      __typename: "RunStatusCaughtUp",
      project_id: PROJECT,
      cursor: 90,
    });

    expect(stream.kinds()).toEqual([
      "RunStatusSnapshot",
      "RunStatusResetRequired",
      "RunStatusEvent",
    ]);
    expect(stream.cursors.get(PROJECT)).toBe(2);

    // Once the refresh succeeds the caller installs the baseline it earned,
    // and normal cursor filtering resumes.
    stream.client.acceptBaseline(90);
    expect(stream.cursors.get(PROJECT)).toBe(90);
    stream.send(event(89));
    stream.send(event(92));
    expect(stream.cursors.get(PROJECT)).toBe(92);
    expect(stream.kinds()).toEqual([
      "RunStatusSnapshot",
      "RunStatusResetRequired",
      "RunStatusEvent",
      "RunStatusEvent",
    ]);
  });

  it("reports a terminal failure and stops applying frames once stopped", async () => {
    const stream = harness();
    await stream.client.start();

    stream.send({
      __typename: "RunStatusFailed",
      code: "status_event_version_unsupported",
      message: "A retained status event uses an unsupported payload version.",
    });
    await stream.client.stop();
    stream.send(event(1));

    expect(stream.kinds()).toEqual(["RunStatusFailed"]);
    expect(stream.unsubscribe).toHaveBeenCalledWith("status-1");
  });
});
