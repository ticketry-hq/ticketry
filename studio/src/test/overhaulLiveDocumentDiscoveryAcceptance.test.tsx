/**
 * Formerly manual: leave a task's workspace open while an agent writes design
 * documents into it, and confirm the tabs appear, refresh, and disappear on
 * their own — without every other open registry being refetched, without a
 * dropped connection hiding work, and without a delayed event from the project
 * you just left touching the one you are now in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";
import { useAgentStatusStore } from "../features/agents/status";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "22222222-2222-2222-2222-222222222222";
const TASK = "33333333-3333-3333-3333-333333333333";
const OTHER_TASK = "55555555-5555-5555-5555-555555555555";
const MODULE = "44444444-4444-4444-4444-444444444444";

/** The prefix a document registry cache entry is matched by. */
const registry = (scope: "task" | "scratch", ownerId: string) =>
  queryKeys.documents.registry(scope, ownerId).slice(0, 4);

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

const documentFact = (
  cursor: number,
  event_kind: "document.changed" | "document.deleted",
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  __typename: "RunStatusEvent",
  cursor,
  event_id: `event-${cursor}`,
  project_id: PROJECT,
  event_kind,
  payload_version: 1,
  subject_kind: "design_document",
  subject_id: `doc-${cursor}`,
  agent_run_id: null,
  automation_attempt_id: null,
  work_item_id: null,
  payload,
  committed_at: "2026-08-17T10:05:00+00:00",
  ...overrides,
});

const snapshot = (cursor: number, projectId = PROJECT) => ({
  __typename: "RunStatusSnapshot",
  project_id: projectId,
  cursor,
  at: "2026-08-17T10:00:00+00:00",
  runs: [],
  automation_attempts: [],
});

type InvalidateSpy = {
  mock: { calls: readonly (readonly [{ queryKey?: unknown }?, ...unknown[]])[] };
};

const invalidatedKeys = (spy: InvalidateSpy) =>
  spy.mock.calls.map(([options]) => options?.queryKey);

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

describe("live document discovery acceptance", () => {
  it("[overhaul-96] refreshes only the registry a document fact names, and recovers authoritatively across replay, reset, and a project switch", async () => {
    const server = transport();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    server.send(snapshot(10));

    // An agent writes into the open task's design directory. Only that task's
    // registry is refetched — the module's scratch workspace and another task's
    // documents are not disturbed by work that did not touch them.
    invalidate.mockClear();
    server.send(
      documentFact(11, "document.changed", {
        documentId: "doc-spec",
        scope: "task",
        ownerId: TASK,
        moduleId: MODULE,
        relPath: "SPEC.md",
        changeKind: "created",
      }),
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(invalidatedKeys(invalidate)).toEqual([registry("task", TASK)]);

    // A burst — several documents written at once — is still one refetch of the
    // one registry that changed.
    invalidate.mockClear();
    for (const [cursor, relPath] of [
      [12, "notes/Design.HTML"],
      [13, "notes/PLAN.md"],
      [14, "SPEC.md"],
    ] as const) {
      server.send(
        documentFact(cursor, "document.changed", {
          documentId: `doc-${relPath}`,
          scope: "task",
          ownerId: TASK,
          moduleId: MODULE,
          relPath,
          changeKind: "changed",
        }),
      );
    }
    await vi.advanceTimersByTimeAsync(60);
    expect(invalidatedKeys(invalidate)).toEqual([registry("task", TASK)]);

    // A removal converges the same registry: the entry still exists, it simply
    // has one row fewer once it is re-read.
    invalidate.mockClear();
    server.send(
      documentFact(15, "document.deleted", {
        documentId: "doc-spec",
        scope: "task",
        ownerId: TASK,
        moduleId: MODULE,
        relPath: "SPEC.md",
        changeKind: "deleted",
      }),
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(invalidatedKeys(invalidate)).toEqual([registry("task", TASK)]);

    // A planning run's output belongs to the module's scratch workspace, and
    // converges that bucket rather than the task's.
    invalidate.mockClear();
    server.send(
      documentFact(16, "document.changed", {
        documentId: "doc-plan",
        scope: "scratch",
        ownerId: MODULE,
        moduleId: MODULE,
        relPath: "Plan.md",
        changeKind: "created",
      }),
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(invalidatedKeys(invalidate)).toEqual([registry("scratch", MODULE)]);
    expect(invalidatedKeys(invalidate)).not.toContainEqual(registry("task", OTHER_TASK));

    // The connection drops and comes back. Replay ends at `caughtUp`, which is
    // the boundary at which the client cannot know what it missed, so every
    // registry is refreshed authoritatively rather than reasoned about.
    invalidate.mockClear();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(server.subscriptions).toHaveLength(2);
    expect(server.subscriptions[1].variables.afterCursor).toBe(16);
    server.send({
      __typename: "RunStatusCaughtUp",
      project_id: PROJECT,
      cursor: 16,
    });
    expect(invalidatedKeys(invalidate)).toContainEqual(["documents", "registry"]);

    // A cursor the server can no longer honour refetches every canonical
    // holding before it installs a new baseline, documents included.
    invalidate.mockClear();
    server.send(snapshot(20), 1);
    server.send(
      {
        __typename: "RunStatusResetRequired",
        project_id: PROJECT,
        cursor: 20,
        reason: "cursor_compacted",
      },
      1,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(invalidatedKeys(invalidate)).toContainEqual(["documents", "registry"]);

    // Switching projects drops everything still queued from the old one: a
    // document fact delivered late for the project just left must not refetch
    // anything in the project now selected.
    statusStreamFeed.start(OTHER_PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    invalidate.mockClear();
    server.send(
      documentFact(21, "document.changed", {
        documentId: "doc-late",
        scope: "task",
        ownerId: TASK,
        moduleId: MODULE,
        relPath: "LATE.md",
        changeKind: "changed",
      }),
      1,
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
