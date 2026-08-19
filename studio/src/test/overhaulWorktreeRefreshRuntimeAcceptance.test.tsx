/**
 * Numbered acceptance for refreshing worktree holdings from durable facts.
 *
 * Every case renders the real block over the desktop runtime and drives the
 * real durable status consumer, so what is asserted is what a person would see:
 * the window that asked keeps its own answer immediately, every window looking
 * at the same checkout catches up from the fact, windows looking at a different
 * checkout are left alone, and the boundaries where no fact can be trusted —
 * reconnect and cursor reset — go back to authoritative Git-backed state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { WorktreeBlock } from "../features/agents/worktrees";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../runtime";
import { queryClient } from "../shared/query/queryClient";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "22222222-2222-2222-2222-222222222222";
const OWNER = "60000000-0000-0000-0000-000000000001";
const CHILD = "60000000-0000-0000-0000-000000000002";
const UNRELATED = "60000000-0000-0000-0000-000000000009";

const startup = {
  endpoints: {
    workTrackerApi: "http://127.0.0.1:8787/api/work-tracker",
    agentApi: "http://127.0.0.1:8787/api",
    statusApi: "http://127.0.0.1:8787/api",
    terminalWebSocket: "ws://127.0.0.1:8787/ws/terminal",
  },
  values: { workTrackerApiKey: "" },
  serviceHealth: {
    state: "ready" as const,
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

const base = {
  kind: "none",
  task_id: OWNER,
  top_level_task_id: OWNER,
  is_shared: false,
  branch: null,
  base_branch: null,
  path: null,
  state: null,
  clean: null,
  dirty: null,
  ahead: null,
  behind: null,
  conflict: null,
  checkout_present: null,
  ephemeral: false,
  reason: null,
};

/** What Git currently holds, as the Rust status query would report it. */
type Held = "absent" | "active" | "conflict";

function statusFor(taskId: string, held: Held) {
  const owner = taskId === CHILD ? OWNER : taskId;
  if (held === "absent") {
    return { ...base, task_id: taskId, top_level_task_id: owner, is_shared: false };
  }
  return {
    ...base,
    task_id: taskId,
    top_level_task_id: owner,
    is_shared: taskId === CHILD,
    kind: "worktree",
    branch: "wt/CODIN-881-parent-story",
    base_branch: "main",
    path: "/checkouts/ticketry/CODIN-881-parent-story",
    state: held === "conflict" ? "conflict" : "active",
    clean: true,
    dirty: false,
    ahead: 0,
    behind: 0,
    conflict: held === "conflict",
    checkout_present: true,
  };
}

interface Request {
  operationName: string;
  variables: Record<string, unknown>;
}

/** The Rust runtime, plus the Git state it is currently reporting. */
function runtime() {
  const reads: string[] = [];
  const requests: Request[] = [];
  let held: Held = "absent";
  const graphql_execute = vi.fn(async (requestJson: string) => {
    const request = JSON.parse(requestJson) as Request;
    requests.push(request);
    const taskId = String(request.variables.taskId);
    if (request.operationName === "WorktreeStatus") {
      reads.push(taskId);
      return JSON.stringify({ data: { worktree_status: statusFor(taskId, held) } });
    }
    if (request.operationName === "WorktreeCreate") {
      held = "active";
      return JSON.stringify({ data: { worktree_create: statusFor(taskId, held) } });
    }
    throw new Error(`Unexpected operation ${request.operationName}`);
  });
  return {
    reads,
    requests,
    hold: (next: Held) => {
      held = next;
    },
    /** How many live status reads one Work Item's view has issued. */
    readsOf: (taskId: string) => reads.filter((read) => read === taskId).length,
    proxy: { graphql_execute, graphql_subscribe: vi.fn() },
  };
}

/** The durable subscription, driven frame by frame. */
function stream() {
  const deliverers: ((encoded: string) => void)[] = [];
  const proxy = {
    graphql_execute: vi.fn(async () => "{}"),
    graphql_subscribe: vi.fn(
      async (_id: string, _request: string, onEvent: (value: string) => void) => {
        deliverers.push(onEvent);
        return '{"type":"accepted"}';
      },
    ),
    graphql_unsubscribe: vi.fn(async () => true),
  };
  const send = (frame: unknown, at = -1) =>
    deliverers.at(at)?.(
      JSON.stringify({ type: "next", payload: { data: { run_status_stream: frame } } }),
    );
  return {
    createProxy: () => proxy as never,
    send,
    started: () => deliverers.length,
  };
}

const worktreeFact = (
  cursor: number,
  changeKind: string,
  overrides: Record<string, unknown> = {},
) => ({
  __typename: "RunStatusEvent",
  cursor,
  event_id: `event-${cursor}`,
  project_id: PROJECT,
  event_kind:
    changeKind === "discarded" || changeKind === "integrated"
      ? "worktree.deleted"
      : "worktree.changed",
  payload_version: 1,
  subject_kind: "worktree",
  subject_id: `wt-${cursor}`,
  agent_run_id: null,
  automation_attempt_id: null,
  work_item_id: null,
  payload: { worktreeId: `wt-${cursor}`, topLevelTaskId: OWNER, changeKind },
  committed_at: "2026-08-17T10:01:00+00:00",
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

const caughtUp = (cursor: number, projectId = PROJECT) => ({
  __typename: "RunStatusCaughtUp",
  project_id: projectId,
  cursor,
});

const resetRequired = (cursor: number, projectId = PROJECT) => ({
  __typename: "RunStatusResetRequired",
  project_id: projectId,
  cursor,
  reason: "cursor_compacted",
});

async function installRuntime(host: ReturnType<typeof runtime>) {
  initializeStudioRuntime(
    await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startup),
      createGraphQlProxy: () => host.proxy as never,
    }),
  );
}

/** The owner's view, a child sharing its checkout, and an unrelated task. */
function renderViews() {
  return render(
    <>
      <WorktreeBlock taskId={OWNER} parentId={null} moduleId="m1" ticketSeq={881} />
      <WorktreeBlock taskId={CHILD} parentId={OWNER} moduleId="m1" ticketSeq={882} />
      <WorktreeBlock taskId={UNRELATED} parentId={null} moduleId="m1" ticketSeq={889} />
    </>,
  );
}

beforeEach(() => {
  queryClient.clear();
  statusStreamFeed.resetCursors(PROJECT);
  statusStreamFeed.resetCursors(OTHER_PROJECT);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  statusStreamFeed.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("worktree holding refresh acceptance", () => {
  it("[overhaul-95] keeps the initiating window's own answer and converges every view of that checkout", async () => {
    const host = runtime();
    await installRuntime(host);
    const feed = stream();
    statusStreamFeed.start(PROJECT, { createProxy: feed.createProxy });
    renderViews();

    await screen.findAllByRole("button", { name: "+ Create worktree" });
    await waitFor(() => expect(feed.started()).toBe(1));
    fireEvent.click(
      screen.getAllByRole("button", { name: "+ Create worktree" })[0],
    );

    // The mutation response is immediate authority for the window that asked.
    expect(
      await screen.findByText("wt/CODIN-881-parent-story → main"),
    ).toBeTruthy();
    const unrelatedReads = host.readsOf(UNRELATED);
    const ownerReads = host.readsOf(OWNER);

    // …and the durable fact still reaches every other window on that checkout.
    feed.send(worktreeFact(11, "created"));

    expect(
      await screen.findByText(`Shares the worktree of its parent task (${OWNER}).`),
    ).toBeTruthy();
    // The window that already had the answer re-reads too: an immediate
    // response is authority, not a reason to suppress a later durable refresh.
    await waitFor(() => expect(host.readsOf(OWNER)).toBeGreaterThan(ownerReads));
    expect(host.readsOf(UNRELATED)).toBe(unrelatedReads);
  });

  it("[overhaul-92] follows a conflict and then a removal back to authoritative state", async () => {
    const host = runtime();
    host.hold("active");
    await installRuntime(host);
    const feed = stream();
    statusStreamFeed.start(PROJECT, { createProxy: feed.createProxy });
    renderViews();

    await screen.findAllByText("wt/CODIN-881-parent-story → main");
    await waitFor(() => expect(feed.started()).toBe(1));

    // An integration attempt stopped inside the checkout.
    host.hold("conflict");
    feed.send(worktreeFact(11, "conflicted"));
    expect(await screen.findAllByText("Conflict")).toHaveLength(1);

    // Discard and integration both end with the checkout gone, and the block
    // returns to the answer Git actually gives — not a blanked panel.
    host.hold("absent");
    feed.send(worktreeFact(12, "discarded"));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "+ Create worktree" }),
      ).toHaveLength(2),
    );
    // Exactly the owner's view and the child sharing it moved. The unrelated
    // task's checkout was never named by the fact and was never re-read.
    expect(host.readsOf(UNRELATED)).toBe(1);
    expect(screen.getAllByText("wt/CODIN-881-parent-story → main")).toHaveLength(
      1,
    );
  });

  it("[overhaul-93] refetches visible state at a reconnect and at a cursor reset", async () => {
    const host = runtime();
    host.hold("active");
    await installRuntime(host);
    const feed = stream();
    statusStreamFeed.start(PROJECT, { createProxy: feed.createProxy });
    renderViews();

    await screen.findAllByText("wt/CODIN-881-parent-story → main");
    await waitFor(() => expect(feed.started()).toBe(1));
    feed.send(snapshot(40));
    const afterFirstRead = host.readsOf(OWNER);

    // Replay is complete: live Git can have moved while the stream was gone
    // without any fact this client received saying so.
    feed.send(caughtUp(40));
    await waitFor(() =>
      expect(host.readsOf(OWNER)).toBeGreaterThan(afterFirstRead),
    );
    const afterReconnect = host.readsOf(OWNER);

    // A reset means the retained cursor is unusable, so nothing cached is a
    // safe base for what follows.
    feed.send(resetRequired(60));
    await waitFor(() =>
      expect(host.readsOf(OWNER)).toBeGreaterThan(afterReconnect),
    );
  });

  it("[overhaul-94] never lets a delayed fact from a previous project mutate the selected one", async () => {
    const host = runtime();
    host.hold("active");
    await installRuntime(host);
    const feed = stream();
    statusStreamFeed.start(PROJECT, { createProxy: feed.createProxy });
    renderViews();

    await screen.findAllByText("wt/CODIN-881-parent-story → main");
    await waitFor(() => expect(feed.started()).toBe(1));

    statusStreamFeed.start(OTHER_PROJECT, { createProxy: feed.createProxy });
    await waitFor(() => expect(feed.started()).toBe(2));
    const before = host.readsOf(OWNER);

    // The previous project's subscription is torn down asynchronously, so its
    // last fact can still arrive — on either subscription.
    feed.send(worktreeFact(11, "created"), 0);
    feed.send(worktreeFact(12, "created"));
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(host.readsOf(OWNER)).toBe(before);
  });
});
