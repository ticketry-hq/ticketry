/**
 * Formerly manual: leave Studio closed long enough for the server to compact
 * the history it was resuming from, reopen it, and confirm the app recovers to
 * an authoritative view — and that an edit made from another window at any
 * point around that recovery is still there afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";
import { getStatesSnapshot, seedStates } from "../shared/query/stateCatalog";
import { useAgentStatusStore } from "../features/agents/status";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";

const PROJECT = "11111111-1111-1111-1111-111111111111";

function transport() {
  const subscriptions: {
    id: string;
    variables: { projectId: string; afterCursor: number | null };
    deliver: (encoded: string) => void;
  }[] = [];
  const proxy = {
    graphql_execute: vi.fn(async () => "{}"),
    graphql_subscribe: vi.fn(
      async (id: string, request: string, onEvent: (value: string) => void) => {
        subscriptions.push({
          id,
          variables: JSON.parse(request).variables,
          deliver: onEvent,
        });
        return '{"type":"accepted"}';
      },
    ),
    graphql_unsubscribe: vi.fn(async () => true),
  };
  const send = (frame: unknown, at = subscriptions.length - 1) =>
    subscriptions[at].deliver(
      JSON.stringify({
        type: "next",
        payload: { data: { run_status_stream: frame } },
      }),
    );
  return { subscriptions, send, createProxy: () => proxy as never };
}

const snapshot = (cursor: number, runs: unknown[] = []) => ({
  __typename: "RunStatusSnapshot",
  project_id: PROJECT,
  cursor,
  at: "2026-08-16T10:00:00+00:00",
  runs,
  automation_attempts: [],
});

const run = {
  agent_run_id: "run-1",
  project_id: PROJECT,
  task_id: "task-1",
  module_id: "module-1",
  agent: "codex",
  scope: "task",
  started_at: "2026-08-16T09:00:00+00:00",
  state: "working",
  updated_at: "2026-08-16T09:00:00+00:00",
  provider_session_id: null,
};

const caughtUp = (cursor: number) => ({
  __typename: "RunStatusCaughtUp",
  project_id: PROJECT,
  cursor,
});

const resetRequired = (cursor: number, reason: string) => ({
  __typename: "RunStatusResetRequired",
  project_id: PROJECT,
  cursor,
  reason,
});

const workflowRename = (cursor: number, name: string) => ({
  __typename: "RunStatusEvent",
  cursor,
  event_id: `event-${cursor}`,
  project_id: PROJECT,
  event_kind: "workflow_state.changed",
  payload_version: 1,
  subject_kind: "workflow_state",
  subject_id: "state-1",
  agent_run_id: null,
  automation_attempt_id: null,
  work_item_id: null,
  payload: {
    stateId: "state-1",
    state: {
      id: "state-1",
      name,
      group: "backlog",
      color: "#111111",
      sort_order: 0,
    },
  },
  committed_at: "2026-08-16T10:05:00+00:00",
});

const workItemEdit = (cursor: number, workItemId: string) => ({
  __typename: "RunStatusEvent",
  cursor,
  event_id: `event-${cursor}`,
  project_id: PROJECT,
  event_kind: "work_item.changed",
  payload_version: 1,
  subject_kind: "work_item",
  subject_id: workItemId,
  agent_run_id: null,
  automation_attempt_id: null,
  work_item_id: workItemId,
  payload: { workItemId, membershipChanged: true },
  committed_at: "2026-08-16T10:06:00+00:00",
});

beforeEach(() => {
  vi.useFakeTimers();
  statusStreamFeed.resetCursors(PROJECT);
  useAgentStatusStore.setState({
    projectId: null,
    runs: {},
    automationAttempts: {},
    automationByTask: {},
  });
  queryClient.clear();
  seedStates(PROJECT, [
    {
      id: "state-1",
      name: "Backlog",
      group: "backlog",
      color: "#111111",
      sort_order: 0,
    } as never,
  ]);
});

afterEach(() => {
  statusStreamFeed.stop();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("authoritative reset recovery acceptance", () => {
  it("[overhaul-83] recovers from every unusable cursor without trusting stale holdings", async () => {
    const server = transport();
    const refresh = vi.spyOn(queryClient, "invalidateQueries");
    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);

    // A cursor the server can still honour replays and needs no reset at all.
    server.send(snapshot(10, [run]));
    server.send(caughtUp(10));
    server.send(workflowRename(11, "Ready"));
    expect(getStatesSnapshot(PROJECT)[0].name).toBe("Ready");
    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("working");

    // Every reason the server can refuse a cursor recovers the same way: the
    // canonical holdings are refetched, the server's high-water cursor becomes
    // the new baseline, and the next handshake resumes from it.
    for (const [index, reason] of [
      "cursor_compacted",
      "cursor_ahead_of_server",
      "replay_bounded",
      "event_version_incompatible",
    ].entries()) {
      const baseline = 100 + index * 100;
      refresh.mockClear();
      server.send(snapshot(baseline, [run]));
      server.send(resetRequired(baseline, reason));
      await vi.advanceTimersByTimeAsync(0);

      expect(
        refresh.mock.calls.map(([options]) => options?.queryKey),
      ).toContainEqual(queryKeys.tasks.all);
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
      expect(
        server.subscriptions[server.subscriptions.length - 1].variables
          .afterCursor,
      ).toBe(baseline);
    }
  });

  it("[overhaul-84] keeps a mutation committed at any reset boundary", async () => {
    const server = transport();
    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    server.send(snapshot(10, [run]));
    server.send(caughtUp(10));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    // Before the reset: applied against the cursor it was measured with.
    server.send(workItemEdit(11, "item-before"));
    await vi.advanceTimersByTimeAsync(60);
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toContainEqual(
      queryKeys.workItems.byId("item-before"),
    );

    // During the reset: buffered while the canonical holdings load, then
    // applied above the installed baseline rather than under it.
    server.send(snapshot(40, [run]));
    server.send(resetRequired(40, "cursor_compacted"));
    server.send(workflowRename(41, "During"));
    server.send(workItemEdit(42, "item-during"));
    expect(getStatesSnapshot(PROJECT)[0].name).toBe("Backlog");
    invalidate.mockClear();
    await vi.advanceTimersByTimeAsync(60);
    expect(getStatesSnapshot(PROJECT)[0].name).toBe("During");
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toContainEqual(
      queryKeys.workItems.byId("item-during"),
    );

    // After the baseline: an ordinary fact again, and the retained cursor has
    // moved past everything the reset drained.
    invalidate.mockClear();
    server.send(workItemEdit(43, "item-after"));
    await vi.advanceTimersByTimeAsync(60);
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toContainEqual(
      queryKeys.workItems.byId("item-after"),
    );
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(
      server.subscriptions[server.subscriptions.length - 1].variables.afterCursor,
    ).toBe(43);
  });
});
