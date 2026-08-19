/**
 * Formerly manual: reconnect the app after losing the network, edit a work
 * item from another window, rename a workflow state, and confirm every open
 * surface converges without a manual reload — while an in-flight local edit is
 * never painted over.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";
import { getStatesSnapshot, seedStates } from "../shared/query/stateCatalog";
import { useAgentStatusStore } from "../features/agents/status";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "22222222-2222-2222-2222-222222222222";

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

const durableEvent = (
  cursor: number,
  event_kind: string,
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  __typename: "RunStatusEvent",
  cursor,
  event_id: `event-${cursor}`,
  project_id: PROJECT,
  event_kind,
  payload_version: 1,
  subject_kind: "work_item",
  subject_id: "subject",
  agent_run_id: null,
  automation_attempt_id: null,
  work_item_id: null,
  payload,
  committed_at: "2026-08-16T10:05:00+00:00",
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  statusStreamFeed.resetCursors(PROJECT);
  statusStreamFeed.resetCursors(OTHER_PROJECT);
  useAgentStatusStore.setState({
    projectId: null,
    runs: {},
    automationAttempts: {},
    automationByTask: {},
  });
  queryClient.clear();
});

afterEach(() => {
  statusStreamFeed.stop();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("durable status consumer acceptance", () => {
  it("[overhaul-82] converges runs, work items, and workflow states across disconnect, reconnect, and project switch", async () => {
    const server = transport();
    seedStates(PROJECT, [
      {
        id: "state-1",
        name: "Backlog",
        group: "backlog",
        color: "#111111",
        sort_order: 0,
      } as never,
    ]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    server.send({
      __typename: "RunStatusSnapshot",
      project_id: PROJECT,
      cursor: 10,
      at: "2026-08-16T10:00:00+00:00",
      runs: [
        {
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
        },
      ],
      automation_attempts: [],
    });
    server.send({ __typename: "RunStatusCaughtUp", project_id: PROJECT, cursor: 10 });
    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("working");

    // A workflow rename from another window reaches the one cached catalog.
    server.send(
      durableEvent(11, "workflow_state.changed", {
        stateId: "state-1",
        state: {
          id: "state-1",
          name: "Ready",
          group: "unstarted",
          color: "#333333",
          sort_order: 0,
        },
      }),
    );
    expect(getStatesSnapshot(PROJECT)[0].name).toBe("Ready");

    // A WorkItem edit while this window has its own mutation in flight defers
    // to that mutation rather than painting an older value over the edit.
    const mutating = vi
      .spyOn(queryClient, "isMutating")
      .mockImplementation(() => 1);
    invalidate.mockClear();
    server.send(
      durableEvent(12, "work_item.changed", {
        workItemId: "item-1",
        membershipChanged: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(invalidate).not.toHaveBeenCalled();

    // Once the local edit settles, an external membership change refreshes both
    // the item and its containing collection.
    mutating.mockImplementation(() => 0);
    invalidate.mockClear();
    server.send(
      durableEvent(13, "work_item.changed", {
        workItemId: "item-1",
        membershipChanged: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual([
      queryKeys.workItems.byId("item-1"),
      queryKeys.tasks.all,
    ]);

    // Losing the network and coming back resumes from the retained cursor and
    // refreshes the capabilities that are not carried by the outbox.
    invalidate.mockClear();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(server.subscriptions).toHaveLength(2);
    expect(server.subscriptions[1].variables.afterCursor).toBe(13);
    server.send({ __typename: "RunStatusCaughtUp", project_id: PROJECT, cursor: 13 });
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toContainEqual([
      "documents",
      "registry",
    ]);

    // A terminal outcome delivered after reconnect is authoritative.
    server.send(
      durableEvent(
        14,
        "agent_run.terminal",
        {
          agentRunId: "run-1",
          state: "exited",
          occurredAt: "2026-08-16T11:00:00+00:00",
        },
        { subject_kind: "agent_run", agent_run_id: "run-1" },
      ),
    );
    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("exited");

    // Switching projects drops everything still queued from the old one.
    statusStreamFeed.start(OTHER_PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    invalidate.mockClear();
    server.send(
      durableEvent(15, "work_item.changed", {
        workItemId: "item-1",
        membershipChanged: true,
      }),
      1,
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
