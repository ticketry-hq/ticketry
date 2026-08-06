import { QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentStatusSnapshot,
  WorkItemStateFrame,
} from "@worktracker/typescript-sdk/agent-status";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import { useClientStore } from "../../../state/clientStore";
import { useAgentStatusStore } from "./store";
import { dispatchStatusFrame, statusFeed } from "./statusFeed";

const getAgentStatus = vi.fn<() => Promise<AgentStatusSnapshot>>();

vi.mock("@worktracker/typescript-sdk/agent-status", async (load) => {
  const actual = await load<
    typeof import("@worktracker/typescript-sdk/agent-status")
  >();
  return {
    ...actual,
    createAgentStatusClient: () => ({ getAgentStatus }),
  };
});

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

function workItemFrame(id: string, revision: number): WorkItemStateFrame {
  return {
    v: 1,
    type: "work_item_state",
    project_id: "project-1",
    work_item_id: id,
    state: null,
    revision,
    updated_at: "2026-08-06T12:00:00Z",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  getAgentStatus.mockReset().mockResolvedValue({
    scope: { project_id: "project-1", task_id: null },
    runs: [],
    automation_attempts: [],
    at: "2026-08-06T12:00:00Z",
  });
  useClientStore.setState({ workItemCursorsByProject: {} });
  useAgentStatusStore.setState({
    projectId: null,
    runs: {},
    byTask: {},
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
    dispatchStatusFrame(workItemFrame("item-b", 5));

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
      runId: "run-1",
      state: "working",
    });
    expect(invalidations).not.toHaveBeenCalled();
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
});
