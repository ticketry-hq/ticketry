import { QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemStateFrame } from "@worktracker/typescript-sdk/agent-status";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import { useClientStore } from "../../../state/clientStore";
import { useAgentStatusStore } from "./store";
import { dispatchStatusFrame, statusFeed } from "./statusFeed";
import { getStatesSnapshot, seedStates } from "../../../shared/query/stateCatalog";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {}
}

function workItemFrame(
  id: string,
  revision: number,
  membershipChanged = false,
): WorkItemStateFrame {
  return {
    v: 1,
    type: "work_item_state",
    project_id: "project-1",
    work_item_id: id,
    state: null,
    revision,
    updated_at: "2026-08-06T12:00:00Z",
    membership_changed: membershipChanged,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  useClientStore.setState({ workItemCursorsByProject: {} });
  useAgentStatusStore.setState({
    projectId: null,
    runs: {},
    automationAttempts: {},
    automationByTask: {},
  });
  queryClient.clear();
});

afterEach(() => {
  statusFeed.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("status feed holdings", () => {
  it("publishes workflow changes only to the shared state catalogue", () => {
    seedStates("project-1", [{
      id: "review",
      name: "Review",
      group: "started",
      color: null,
      sort_order: 1,
    }]);

    dispatchStatusFrame({
      v: 1,
      type: "workflow_state",
      project_id: "project-1",
      state: {
        id: "review",
        name: "Quality review",
        group: "started",
        color: null,
        sort_order: 1,
      } as NonNullable<WorkItemStateFrame["state"]>,
      updated_at: "2026-08-06T12:00:00Z",
    });

    expect(getStatesSnapshot("project-1")).toMatchObject([
      { id: "review", name: "Quality review" },
    ]);
  });

  it("refreshes each named holding once per burst and structural membership once", async () => {
    const itemKey = queryKeys.workItems.byId("item-a");
    const treeKey = queryKeys.tasks.byModule("project-1", "module-1");
    queryClient.setQueryData(itemKey, { id: "item-a", name: "stale" });
    queryClient.setQueryData(treeKey, { order: ["item-a"] });

    const itemRead = vi.fn().mockResolvedValue({ id: "item-a", name: "fresh" });
    const treeRead = vi.fn().mockResolvedValue({ order: ["item-a", "item-b"] });
    const itemObserver = new QueryObserver(queryClient, {
      queryKey: itemKey,
      queryFn: itemRead,
      staleTime: Infinity,
    });
    const treeObserver = new QueryObserver(queryClient, {
      queryKey: treeKey,
      queryFn: treeRead,
      staleTime: Infinity,
    });
    const unsubscribeItem = itemObserver.subscribe(() => undefined);
    const unsubscribeTree = treeObserver.subscribe(() => undefined);
    const invalidations = vi.spyOn(queryClient, "invalidateQueries");

    statusFeed.start("project-1");
    dispatchStatusFrame(workItemFrame("item-a", 4));
    dispatchStatusFrame(workItemFrame("item-a", 4));
    dispatchStatusFrame(workItemFrame("item-b", 5, true));

    expect(useClientStore.getState().workItemCursorsByProject["project-1"])
      .toBe(5);
    await vi.advanceTimersByTimeAsync(49);
    expect(invalidations).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(itemRead).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(treeRead).toHaveBeenCalledTimes(1));

    expect(
      invalidations.mock.calls.filter(
        ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(itemKey),
      ),
    ).toHaveLength(1);
    expect(
      invalidations.mock.calls.filter(
        ([filters]) =>
          JSON.stringify(filters?.queryKey) ===
          JSON.stringify(queryKeys.workItems.byId("item-b")),
      ),
    ).toHaveLength(1);
    expect(
      invalidations.mock.calls.filter(
        ([filters]) =>
          JSON.stringify(filters?.queryKey) === JSON.stringify(queryKeys.tasks.all),
      ),
    ).toHaveLength(1);

    unsubscribeItem();
    unsubscribeTree();
  });

  it("applies run values directly without scheduling a work-item read", async () => {
    const invalidations = vi.spyOn(queryClient, "invalidateQueries");
    statusFeed.start("project-1");

    dispatchStatusFrame({
      v: 1,
      type: "agent_lifecycle",
      at: "2026-08-06T12:01:00Z",
      run: {
        agent_run_id: "run-1",
        task_id: "item-a",
        module_id: "module-1",
        scope: "task",
        state: "working",
        updated_at: "2026-08-06T12:01:00Z",
      },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(useAgentStatusStore.getState().runs["run-1"]).toMatchObject({
      agent_run_id: "run-1",
      state: "working",
    });
    expect(invalidations).not.toHaveBeenCalled();
  });

  it("does not overwrite an optimistic local edit with a feed refetch", async () => {
    const itemKey = queryKeys.workItems.byId("item-a");
    queryClient.setQueryData(itemKey, { id: "item-a", name: "local draft" });
    vi.spyOn(queryClient, "isMutating").mockReturnValue(1);
    const invalidations = vi.spyOn(queryClient, "invalidateQueries");
    statusFeed.start("project-1");

    dispatchStatusFrame(workItemFrame("item-a", 4));
    await vi.advanceTimersByTimeAsync(50);

    expect(queryClient.getQueryData(itemKey)).toEqual({
      id: "item-a",
      name: "local draft",
    });
    expect(invalidations).not.toHaveBeenCalledWith({
      queryKey: itemKey,
      exact: true,
    });
    expect(useClientStore.getState().workItemCursorsByProject["project-1"])
      .toBe(4);
  });

  it("sends the client-store cursor again after a disconnect", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    useClientStore.setState({ workItemCursorsByProject: { "project-1": 7 } });
    statusFeed.start("project-1");

    expect(FakeWebSocket.instances[0].url).toContain("cursor=7");
    FakeWebSocket.instances[0].onmessage?.({
      data: JSON.stringify(workItemFrame("item-a", 9)),
    } as MessageEvent);
    FakeWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        v: 1,
        type: "cursor",
        project_id: "project-1",
        revision: 11,
      }),
    } as MessageEvent);
    FakeWebSocket.instances[0].onclose?.();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(useClientStore.getState().workItemCursorsByProject["project-1"])
      .toBe(11);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toContain("cursor=11");
  });

  it("reconnects immediately with the retained cursor when the browser comes online", () => {
    useClientStore.setState({ workItemCursorsByProject: { "project-1": 13 } });
    statusFeed.start("project-1");

    window.dispatchEvent(new Event("online"));

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toContain("cursor=13");
  });

  it("ignores a queued snapshot from the project socket that was just closed", () => {
    statusFeed.start("project-1");
    const previous = FakeWebSocket.instances[0];

    statusFeed.start("project-2");
    useAgentStatusStore.getState().upsertRun({
      agent_run_id: "run-2",
      project_id: "project-2",
      task_id: "item-2",
      module_id: "module-2",
      agent: "codex",
      scope: "task",
      started_at: "2026-08-07T12:00:00Z",
      state: "working",
      updated_at: "2026-08-07T12:00:00Z",
    });

    previous.onmessage?.({
      data: JSON.stringify({
        v: 1,
        type: "snapshot",
        scope: { project_id: "project-1", task_id: null },
        runs: [],
        automation_attempts: [],
        at: "2026-08-07T12:01:00Z",
      }),
    } as MessageEvent);

    expect(useAgentStatusStore.getState().runs["run-2"]?.state).toBe("working");
  });
});
