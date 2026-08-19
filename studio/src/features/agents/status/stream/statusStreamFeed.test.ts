/**
 * The durable status consumer's convergence rules.
 *
 * Every case drives the transport directly, so the frames a real server would
 * emit at each boundary — snapshot, replay, caught-up, reset, failure,
 * disconnect — are exercised without a live subscription.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../../../../shared/query/queryClient";
import { queryKeys } from "../../../../shared/query/keys";
import { getStatesSnapshot, seedStates } from "../../../../shared/query/stateCatalog";
import { useAgentStatusStore } from "../store";
import { statusStreamFeed } from "./statusStreamFeed";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "22222222-2222-2222-2222-222222222222";

interface Subscription {
  readonly id: string;
  readonly variables: { projectId: string; afterCursor: number | null };
  readonly deliver: (encoded: string) => void;
}

function harness() {
  const subscriptions: Subscription[] = [];
  const unsubscribed: string[] = [];
  const proxy = {
    graphql_execute: vi.fn(async () => "{}"),
    graphql_subscribe: vi.fn(
      async (
        id: string,
        requestJson: string,
        onEvent: (value: string) => void,
      ) => {
        subscriptions.push({
          id,
          variables: JSON.parse(requestJson).variables,
          deliver: onEvent,
        });
        return '{"type":"accepted"}';
      },
    ),
    graphql_unsubscribe: vi.fn(async (id: string) => {
      unsubscribed.push(id);
      return true;
    }),
  };
  const send = (frame: unknown, at = subscriptions.length - 1) =>
    subscriptions[at].deliver(
      JSON.stringify({ type: "next", payload: { data: { run_status_stream: frame } } }),
    );
  const complete = (at = subscriptions.length - 1) =>
    subscriptions[at].deliver(JSON.stringify({ type: "complete" }));
  return {
    subscriptions,
    unsubscribed,
    send,
    complete,
    createProxy: () => proxy as never,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function snapshot(
  cursor: number,
  runs: unknown[] = [],
  attempts: unknown[] = [],
  projectId = PROJECT,
) {
  return {
    __typename: "RunStatusSnapshot",
    project_id: projectId,
    cursor,
    at: "2026-08-16T10:00:00+00:00",
    runs,
    automation_attempts: attempts,
  };
}

function event(
  cursor: number,
  kind: string,
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    __typename: "RunStatusEvent",
    cursor,
    event_id: `event-${cursor}`,
    project_id: PROJECT,
    event_kind: kind,
    payload_version: 1,
    subject_kind: "work_item",
    subject_id: "subject",
    agent_run_id: null,
    automation_attempt_id: null,
    work_item_id: null,
    payload,
    committed_at: "2026-08-16T10:01:00+00:00",
    ...overrides,
  };
}

const caughtUp = (cursor: number, projectId = PROJECT) => ({
  __typename: "RunStatusCaughtUp",
  project_id: projectId,
  cursor,
});

const reset = (
  cursor: number,
  reason = "cursor_compacted",
  projectId = PROJECT,
) => ({
  __typename: "RunStatusResetRequired",
  project_id: projectId,
  cursor,
  reason,
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

describe("snapshot reconciliation", () => {
  it("installs the authoritative holding for the selected project", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);

    transport.send(snapshot(10, [run()]));

    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("working");
  });

  it("never lets a queued snapshot from the previous project mark runs exited", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    transport.send(snapshot(10, [run()]));

    statusStreamFeed.start(OTHER_PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    useAgentStatusStore.getState().upsertRun(run({ project_id: OTHER_PROJECT }) as never);
    // The previous project's socket is torn down asynchronously, so its last
    // snapshot can still arrive after the switch.
    transport.send(snapshot(11, []), 0);

    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("working");
  });

  it("keeps a run started after the snapshot stamp alive", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    useAgentStatusStore
      .getState()
      .upsertRun(run({ updated_at: "2026-08-16T10:00:00.500000+00:00", state: "starting" }) as never);

    transport.send(snapshot(10, []));

    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("starting");
  });

  it("prefers a terminal outcome over a stale live state", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    transport.send(snapshot(10, [run()]));

    transport.send(
      event(
        11,
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
  });

  it("restores authoritative Automation Attempt lineage from the snapshot", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);

    transport.send(
      snapshot(10, [], [
        {
          attempt_id: "attempt-2",
          root_attempt_id: "attempt-1",
          retry_of_attempt_id: "attempt-1",
          work_item_id: "task-1",
          status: "failed",
          error: "boom",
          failure: { code: "provider_not_activated", retryable: true },
          retryable: true,
          agent_run_id: null,
          updated_at: "2026-08-16T09:30:00+00:00",
        },
      ]),
    );

    const holding = useAgentStatusStore.getState();
    expect(holding.automationAttempts["attempt-1"].attempt_id).toBe("attempt-2");
    expect(holding.automationAttempts["attempt-1"].failure?.code).toBe(
      "provider_not_activated",
    );
    expect(holding.automationByTask["task-1"]).toEqual(["attempt-1"]);
  });
});

describe("WorkItem convergence", () => {
  it("batches the canonical entity and refreshes the collection only on membership changes", async () => {
    const transport = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    invalidate.mockClear();

    transport.send(
      event(11, "work_item.changed", {
        workItemId: "item-1",
        membershipChanged: false,
      }),
    );
    transport.send(
      event(12, "work_item.changed", {
        workItemId: "item-1",
        membershipChanged: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(60);

    const keys = invalidate.mock.calls.map(([options]) => options?.queryKey);
    expect(keys).toEqual([queryKeys.workItems.byId("item-1")]);

    invalidate.mockClear();
    transport.send(
      event(13, "work_item.changed", {
        workItemId: "item-2",
        membershipChanged: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual([
      queryKeys.workItems.byId("item-2"),
      queryKeys.tasks.all,
    ]);
  });

  it("defers to an in-flight optimistic edit instead of painting over it", async () => {
    const transport = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    vi.spyOn(queryClient, "isMutating").mockImplementation(() => 1);
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    invalidate.mockClear();

    transport.send(
      event(11, "work_item.changed", {
        workItemId: "item-1",
        membershipChanged: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(60);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("evicts a deleted identity and refreshes its collection", async () => {
    const transport = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const remove = vi.spyOn(queryClient, "removeQueries");
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    invalidate.mockClear();

    transport.send(event(11, "work_item.deleted", { workItemId: "item-9" }));
    await vi.advanceTimersByTimeAsync(60);

    expect(remove.mock.calls.map(([options]) => options?.queryKey)).toEqual([
      queryKeys.workItems.byId("item-9"),
    ]);
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual([
      queryKeys.tasks.all,
    ]);
  });
});

describe("workflow convergence", () => {
  it("applies a rename, recolour, and reorder without a reload", async () => {
    const transport = harness();
    seedStates(PROJECT, [
      {
        id: "state-1",
        name: "Backlog",
        group: "backlog",
        color: "#111111",
        sort_order: 0,
      } as never,
    ]);
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);

    transport.send(
      event(11, "workflow_state.changed", {
        stateId: "state-1",
        state: {
          id: "state-1",
          name: "Ready",
          group: "unstarted",
          color: "#222222",
          sort_order: 3,
        },
      }),
    );

    expect(getStatesSnapshot(PROJECT)).toEqual([
      {
        id: "state-1",
        name: "Ready",
        group: "unstarted",
        color: "#222222",
        sort_order: 3,
      },
    ]);
  });

  it("removes a deleted state from the one cached catalog", async () => {
    const transport = harness();
    seedStates(PROJECT, [
      { id: "state-1", name: "Backlog", group: "backlog", color: "#111111", sort_order: 0 } as never,
      { id: "state-2", name: "Done", group: "completed", color: "#222222", sort_order: 1 } as never,
    ]);
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);

    transport.send(event(11, "workflow_state.deleted", { stateId: "state-2" }));

    expect(getStatesSnapshot(PROJECT).map((state) => state.id)).toEqual(["state-1"]);
  });
});

describe("connection lifecycle", () => {
  it("resumes from the retained cursor after a disconnect", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.subscriptions[0].variables.afterCursor).toBeNull();
    transport.send(snapshot(10));
    transport.send(caughtUp(10));

    transport.complete();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(transport.subscriptions).toHaveLength(2);
    expect(transport.subscriptions[1].variables.afterCursor).toBe(10);
  });

  it("backs off between repeated failures", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);

    transport.send({
      __typename: "RunStatusFailed",
      code: "runs_unavailable",
      message: "unavailable",
    });
    await vi.advanceTimersByTimeAsync(1_300);
    expect(transport.subscriptions).toHaveLength(2);

    transport.send({
      __typename: "RunStatusFailed",
      code: "runs_unavailable",
      message: "unavailable",
    });
    await vi.advanceTimersByTimeAsync(900);
    expect(transport.subscriptions).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(transport.subscriptions).toHaveLength(3);
  });

  it("reconnects immediately when the page comes back online", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(transport.subscriptions).toHaveLength(2);
    expect(transport.unsubscribed).toContain(transport.subscriptions[0].id);
  });

  it("refreshes authoritative document registries at each caught-up boundary", async () => {
    const transport = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    invalidate.mockClear();

    transport.send(caughtUp(10));

    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toContainEqual([
      "documents",
      "registry",
    ]);
  });

  it("refetches canonical holdings before installing a reset baseline", async () => {
    const transport = harness();
    const refetch = vi.spyOn(queryClient, "invalidateQueries");
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    transport.send(snapshot(40, [run()]));
    refetch.mockClear();

    transport.send(reset(40));
    await vi.advanceTimersByTimeAsync(0);

    // Every canonical holding outside the outbox is re-read; Agent Runs and
    // Automation Attempts came from this handshake's own snapshot.
    expect(refetch.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      queryKeys.tasks.all,
      ["workItem"],
      ["work-items"],
      queryKeys.workflows.catalog(PROJECT),
      queryKeys.states.byProject(PROJECT),
      ["documents", "registry"],
      queryKeys.worktrees.all,
    ]);
    // Only now is the server's high-water cursor trusted as a baseline.
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.subscriptions[1].variables.afterCursor).toBe(40);
  });

  it("buffers newer facts through a reset and applies only those above the baseline", async () => {
    const transport = harness();
    seedStates(PROJECT, [
      { id: "state-1", name: "Backlog", group: "backlog", color: "#000000", sort_order: 0 } as never,
    ]);
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    transport.send(snapshot(40, [run()]));

    transport.send(reset(40));
    // Committed while the refresh is in flight, in the order the server sent
    // them, including one the refetched holdings already reflect.
    transport.send(
      event(39, "workflow_state.changed", {
        stateId: "state-1",
        state: { id: "state-1", name: "Stale", group: "backlog", color: "#111111", sort_order: 0 },
      }),
    );
    transport.send(
      event(42, "workflow_state.changed", {
        stateId: "state-1",
        state: { id: "state-1", name: "Second", group: "started", color: "#222222", sort_order: 0 },
      }),
    );
    transport.send(
      event(41, "workflow_state.changed", {
        stateId: "state-1",
        state: { id: "state-1", name: "First", group: "unstarted", color: "#333333", sort_order: 0 },
      }),
    );
    expect(getStatesSnapshot(PROJECT)[0].name).toBe("Backlog");

    await vi.advanceTimersByTimeAsync(300);

    // Cursor order, not arrival order, and nothing at or below the baseline.
    expect(getStatesSnapshot(PROJECT)[0].name).toBe("Second");
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.subscriptions[1].variables.afterCursor).toBe(42);
  });

  it("retries the subscription without baselining when the refresh fails", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    transport.send(caughtUp(10));
    transport.send(snapshot(40, [run()]));
    vi.spyOn(queryClient, "invalidateQueries").mockRejectedValue(
      new Error("the canonical read failed"),
    );

    transport.send(reset(40));
    transport.send(
      event(41, "work_item.changed", {
        workItemId: "item-1",
        membershipChanged: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(2_000);

    // The stale cursor stands: nothing was baselined over holdings that did
    // not load, and the retry resumes from what the server already refused.
    expect(transport.subscriptions).toHaveLength(2);
    expect(transport.subscriptions[1].variables.afterCursor).toBe(10);
    expect(transport.unsubscribed).toContain(transport.subscriptions[0].id);
  });

  it("refuses to baseline a reset that arrived without an authoritative snapshot", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    transport.send(caughtUp(10));

    // Agent Run holdings and Automation Attempts are re-read by the handshake's
    // own snapshot. Without one there is nothing authoritative to baseline on.
    transport.send(reset(40));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(transport.subscriptions).toHaveLength(2);
    expect(transport.subscriptions[1].variables.afterCursor).toBe(10);
  });

  it("writes nothing when the project is switched during a reset", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    transport.send(snapshot(40, [run()]));
    transport.send(reset(40));
    transport.send(
      event(41, "work_item.changed", {
        workItemId: "item-1",
        membershipChanged: true,
      }),
    );

    statusStreamFeed.start(OTHER_PROJECT, { createProxy: transport.createProxy });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await vi.advanceTimersByTimeAsync(300);

    expect(invalidate).not.toHaveBeenCalled();
    expect(useAgentStatusStore.getState().projectId).toBe(OTHER_PROJECT);
  });

  it("re-handshakes for a fact about a run this holding has never seen", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    transport.send(snapshot(10));

    transport.send(
      event(
        11,
        "agent_run.lifecycle",
        {
          agentRunId: "run-unknown",
          state: "starting",
          occurredAt: "2026-08-16T10:02:00+00:00",
        },
        { subject_kind: "agent_run", agent_run_id: "run-unknown" },
      ),
    );
    await vi.advanceTimersByTimeAsync(300);

    expect(transport.subscriptions).toHaveLength(2);
  });

  it("drops queued results from the project it no longer owns", async () => {
    const transport = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    statusStreamFeed.start(OTHER_PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    invalidate.mockClear();

    transport.send(
      event(11, "work_item.changed", { workItemId: "item-1", membershipChanged: true }),
      0,
    );
    await vi.advanceTimersByTimeAsync(60);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("stops writing anything once the feed is stopped", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    transport.send(snapshot(10, [run()]));

    statusStreamFeed.stop();
    transport.send(
      event(
        11,
        "agent_run.terminal",
        { agentRunId: "run-1", state: "exited", occurredAt: "2026-08-16T11:00:00+00:00" },
        { subject_kind: "agent_run", agent_run_id: "run-1" },
      ),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("working");
    expect(transport.subscriptions).toHaveLength(1);
  });
});

describe("worktree holdings", () => {
  const OWNER = "60000000-0000-0000-0000-000000000001";
  const CHILD = "60000000-0000-0000-0000-000000000002";
  const OTHER_OWNER = "60000000-0000-0000-0000-000000000009";

  const worktreeFact = (
    cursor: number,
    changeKind: string,
    overrides: Record<string, unknown> = {},
  ) =>
    event(
      cursor,
      changeKind === "discarded" || changeKind === "integrated"
        ? "worktree.deleted"
        : "worktree.changed",
      { worktreeId: `wt-${cursor}`, topLevelTaskId: OWNER, changeKind },
      { subject_kind: "worktree", subject_id: `wt-${cursor}`, ...overrides },
    );

  /** A holding a surface is displaying, so an invalidation actually refetches. */
  const seedHolding = (
    ownerKeyId: string,
    taskId: string,
    reportedOwner = ownerKeyId,
  ) => {
    const key = queryKeys.worktrees.status(ownerKeyId, taskId, null);
    queryClient.setQueryData(key, {
      kind: "worktree",
      task_id: taskId,
      top_level_task_id: reportedOwner,
    });
    return key;
  };

  /** The cache entries each recorded invalidation actually selected. */
  const invalidatedKeys = (invalidate: { mock: { calls: unknown[][] } }) =>
    invalidate.mock.calls.flatMap(([options]) =>
      queryClient
        .getQueryCache()
        .findAll(options as never)
        .map((query) => query.queryKey),
    );

  it.each(["created", "conflicted", "discarded", "integrated", "reconciled"])(
    "converges the owner's holding for a %s fact",
    async (changeKind) => {
      const transport = harness();
      statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
      await vi.advanceTimersByTimeAsync(0);
      const owned = seedHolding(OWNER, OWNER);
      const foreign = seedHolding(OTHER_OWNER, OTHER_OWNER);
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");

      transport.send(worktreeFact(11, changeKind));
      await vi.advanceTimersByTimeAsync(60);

      const keys = invalidatedKeys(invalidate);
      expect(keys).toContainEqual(owned);
      expect(keys).not.toContainEqual(foreign);
    },
  );

  it("converges a child view sharing the owner's checkout", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    const parentView = seedHolding(OWNER, OWNER);
    const childView = seedHolding(OWNER, CHILD);
    // A view keyed under an intermediate ancestor still reports the true owner.
    const grandchildView = seedHolding(CHILD, "grandchild", OWNER);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    transport.send(worktreeFact(11, "created"));
    await vi.advanceTimersByTimeAsync(60);

    const keys = invalidatedKeys(invalidate);
    expect(keys).toContainEqual(parentView);
    expect(keys).toContainEqual(childView);
    expect(keys).toContainEqual(grandchildView);
  });

  it("costs one refetch for a burst about the same checkout", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    seedHolding(OWNER, OWNER);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    transport.send(worktreeFact(11, "created"));
    transport.send(worktreeFact(12, "reconciled"));
    await vi.advanceTimersByTimeAsync(60);

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("skips a fact that names no owner", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    seedHolding(OWNER, OWNER);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    transport.send(
      event(11, "worktree.changed", { worktreeId: "wt-11", changeKind: "created" }),
    );
    await vi.advanceTimersByTimeAsync(60);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("re-reads every visible holding at each caught-up boundary", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    transport.send(caughtUp(10));

    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toContainEqual(
      queryKeys.worktrees.all,
    );
  });

  it("never lets a delayed fact from the previous project touch the new one", async () => {
    const transport = harness();
    statusStreamFeed.start(PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    statusStreamFeed.start(OTHER_PROJECT, { createProxy: transport.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    seedHolding(OWNER, OWNER);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    // The previous project's subscription is torn down asynchronously, so its
    // last fact can still arrive — and it is partitioned into that project.
    transport.send(worktreeFact(11, "created", { project_id: PROJECT }), 0);
    // Even a fact redelivered on the *current* subscription cannot mutate this
    // project if the outbox partitioned it into another one.
    transport.send(worktreeFact(12, "created", { project_id: PROJECT }));
    await vi.advanceTimersByTimeAsync(60);

    expect(invalidate).not.toHaveBeenCalled();
  });
});
