import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatusSnapshot } from "@worktracker/typescript-sdk";
import { dispatchStatusFrame, statusFeed } from "../features/agents/status/statusFeed";
import { useAgentStatusStore } from "../features/agents/status";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import { groupAndOrderTasks } from "../features/studio/lib/presenter";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import type { TaskSummary } from "../features/studio/lib/types";
import type { WorkItem, WorkItemDetail } from "../shared/api/types";

const getAgentStatus = vi.fn<() => Promise<AgentStatusSnapshot>>();

vi.mock("@worktracker/typescript-sdk/agent-status", async (load) => {
  const actual = await load<typeof import("@worktracker/typescript-sdk/agent-status")>();
  return {
    ...actual,
    createAgentStatusClient: () => ({ getAgentStatus }),
  };
});

const getTasks = vi.hoisted(() => vi.fn());

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return { ...actual, getWorkItem: vi.fn(), getTasks };
});

import * as client from "../shared/api/client";
const getWorkItem = client.getWorkItem as ReturnType<typeof vi.fn>;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

const TODO = { id: "todo", name: "Todo", group: "unstarted", color: null };
const DONE = { id: "done", name: "Done", group: "completed", color: "#0a0" };

function taskRow(partial: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "task-1",
    name: "Story",
    project_id: "project-1",
    sequence_id: 1,
    state: TODO,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
    state_revision: 1,
    ...partial,
    issue_type: partial.issue_type ?? { id: "type-story", name: "Story", level: "task" },
  };
}

function workItem(partial: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "task-1",
    name: "Story",
    project_id: "project-1",
    sequence_id: 1,
    key: "MEML-1",
    issue_type: { id: "story", name: "Story", level: "task" },
    state: TODO,
    state_revision: 1,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-07-12T09:00:00Z",
    updated_at: "2026-07-12T10:00:00Z",
    ...partial,
  };
}

function detail(task: WorkItem): WorkItemDetail {
  return { task, attachments: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function stateFrame(revision: number, overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    type: "work_item_state",
    project_id: "project-1",
    work_item_id: "task-1",
    state: { ...DONE, sort_order: 7, is_protected: false },
    revision,
    updated_at: "2026-07-12T10:01:00Z",
    ...overrides,
  } as Parameters<typeof dispatchStatusFrame>[0];
}

beforeEach(() => {
  statusFeed.stop();
  getAgentStatus.mockReset().mockResolvedValue({
    scope: { project_id: "project-1", task_id: null },
    runs: [],
    automation_attempts: [],
    at: "2026-07-12T10:00:00Z",
  } as unknown as AgentStatusSnapshot);
  getWorkItem.mockReset();
  getTasks.mockReset();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  useAgentStatusStore.setState({
    projectId: null,
    runs: {},
    byTask: {},
    automationAttempts: {},
    automationByTask: {},
  });
  useBacklogStore.setState({
    projectId: null,
    items: [],
    states: [],
    loading: false,
    seenStateRevisions: {},
    pendingStateDeltas: {},
  });
  useTasksStore.setState({
    selectedProjectId: "project-1",
    selectedModuleId: "module-1",
    tasks: [taskRow()],
    subtasks: { "task-1": [taskRow({ id: "child-1", parent_id: "task-1" })] },
    details: { task: taskRow() },
    seenStateRevisions: {},
    pendingStateDeltas: {},
  });
});

describe("studio Stories tree status feed", () => {
  it("self-heals every active catalog and embedded copy after another client changes a group", () => {
    const staleReview = {
      id: "review",
      name: "Review",
      group: "started",
      color: "#7dcfff",
    };
    const doing = {
      id: "doing",
      name: "Doing",
      group: "started",
      color: "#ff9e64",
    };
    useTasksStore.setState({
      states: [staleReview, doing],
      tasks: [taskRow({ state: staleReview })],
      subtasks: {
        "task-1": [
          taskRow({ id: "child-1", parent_id: "task-1", state: staleReview }),
        ],
      },
      details: { task: taskRow({ state: staleReview }) },
    });
    useBacklogStore.setState({
      projectId: "project-1",
      states: [staleReview, doing],
      items: [workItem({ state: staleReview })],
    });
    useWorkflowEditorStore.setState({
      projectId: "project-1",
      states: [staleReview, doing],
    });

    dispatchStatusFrame({
      v: 1,
      type: "workflow_state",
      project_id: "project-1",
      state: {
        ...staleReview,
        group: "completed",
        sort_order: 2,
        is_protected: false,
      },
      updated_at: "2026-07-25T10:01:00Z",
    });

    expect(
      useTasksStore.getState().states.find((state) => state.id === "review"),
    ).toMatchObject({ id: "review", group: "completed" });
    expect(useTasksStore.getState().tasks[0].state.group).toBe("completed");
    expect(useTasksStore.getState().subtasks["task-1"][0].state.group)
      .toBe("completed");
    expect(useTasksStore.getState().details?.task.state.group).toBe("completed");
    expect(useBacklogStore.getState().states[1]).toMatchObject({
      id: "review",
      group: "completed",
    });
    expect(useBacklogStore.getState().items[0].state?.group).toBe("completed");
    expect(useWorkflowEditorStore.getState().states[1]).toMatchObject({
      id: "review",
      group: "completed",
    });
    expect(
      groupAndOrderTasks(
        useTasksStore.getState().tasks,
        useTasksStore
          .getState()
          .states.filter((state) => state.id !== null)
          .map(({ sort_order: _, ...state }) => state),
      ).orderedStates.map((state) => state.id),
    ).toEqual(["doing", "review"]);
  });

  it("repairs a group change missed before reconnect from the socket snapshot", () => {
    const staleReview = {
      id: "review",
      name: "Review",
      group: "started",
      color: "#7dcfff",
    };
    useTasksStore.setState({
      states: [staleReview],
      tasks: [taskRow({ state: staleReview })],
    });
    useBacklogStore.setState({
      projectId: "project-1",
      states: [staleReview],
      items: [workItem({ state: staleReview })],
    });

    dispatchStatusFrame({
      v: 1,
      type: "snapshot",
      ...useAgentStatusStore.getState(),
      scope: { project_id: "project-1", task_id: null },
      runs: [],
      automation_attempts: [],
      at: "2026-07-25T10:02:00Z",
      workflow_states: [{
        ...staleReview,
        group: "completed",
        sort_order: 2,
        is_protected: false,
      }],
    });

    expect(
      useTasksStore.getState().states.find((state) => state.id === "review")
        ?.group,
    ).toBe("completed");
    expect(useTasksStore.getState().tasks[0].state.group).toBe("completed");
    expect(useBacklogStore.getState().states[0].group).toBe("completed");
    expect(useBacklogStore.getState().items[0].state?.group).toBe("completed");
  });

  it("keeps a cross-client group change over a slower catalog load", async () => {
    const staleReview = {
      id: "review",
      name: "Review",
      group: "started",
      color: "#7dcfff",
    };
    const pendingTasks = deferred<{
      tasks: TaskSummary[];
      subtasks: Record<string, TaskSummary[]>;
      states: typeof staleReview[];
    }>();
    getTasks.mockReturnValue(pendingTasks.promise);
    useTasksStore.setState({
      states: [staleReview],
      tasks: [],
      subtasks: {},
      details: null,
    });

    const loading = useTasksStore
      .getState()
      .loadTasks("project-1", "module-1");
    dispatchStatusFrame({
      v: 1,
      type: "workflow_state",
      project_id: "project-1",
      state: {
        ...staleReview,
        group: "completed",
        sort_order: 2,
        is_protected: false,
      },
      updated_at: "2026-07-25T10:03:00Z",
    });
    pendingTasks.resolve({
      tasks: [taskRow({ state: staleReview })],
      subtasks: {
        "task-1": [
          taskRow({ id: "child-1", parent_id: "task-1", state: staleReview }),
        ],
      },
      states: [staleReview],
    });
    await loading;

    const store = useTasksStore.getState();
    expect(store.states.find((state) => state.id === "review")?.group)
      .toBe("completed");
    expect(store.tasks.find((task) => task.id === "task-1")?.state.group)
      .toBe("completed");
    expect(store.subtasks["task-1"][0].state.group).toBe("completed");
  });

  it("moves a Story to its new state section without a reload", () => {
    dispatchStatusFrame(stateFrame(2));

    const store = useTasksStore.getState();
    expect(store.tasks[0]).toMatchObject({
      state: { id: "done", name: "Done" },
      state_revision: 2,
      name: "Story",
    });
    expect(store.details?.task.state.id).toBe("done");
  });

  it("updates a subtask row so child status chicklets stay live", () => {
    dispatchStatusFrame(stateFrame(2, { work_item_id: "child-1" }));

    expect(useTasksStore.getState().subtasks["task-1"][0]).toMatchObject({
      id: "child-1",
      state: { id: "done" },
      state_revision: 2,
    });
  });

  it("rejects stale, duplicate, and foreign-project frames", () => {
    dispatchStatusFrame(stateFrame(3));
    // Same revision again and an older one must both lose.
    dispatchStatusFrame(
      stateFrame(3, { state: { ...TODO, sort_order: 0, is_protected: false } }),
    );
    dispatchStatusFrame(
      stateFrame(2, { state: { ...TODO, sort_order: 0, is_protected: false } }),
    );
    dispatchStatusFrame(
      stateFrame(9, {
        project_id: "project-2",
        state: { ...TODO, sort_order: 0, is_protected: false },
      }),
    );

    expect(useTasksStore.getState().tasks[0]).toMatchObject({
      state: { id: "done" },
      state_revision: 3,
    });
  });

  it("reconciles the targeted authoritative detail after the immediate move", async () => {
    getWorkItem.mockResolvedValue(
      detail(
        workItem({
          state: DONE,
          state_revision: 2,
          name: "Authoritative Story",
          sub_issues_count: 5,
        }),
      ),
    );
    statusFeed.start("project-1");

    dispatchStatusFrame(stateFrame(2));

    expect(getWorkItem).toHaveBeenCalledWith("task-1", expect.any(AbortSignal));
    await vi.waitFor(() =>
      expect(useTasksStore.getState().tasks[0]).toMatchObject({
        name: "Authoritative Story",
        sub_issues_count: 5,
        state: { id: "done" },
      }),
    );
  });

  it("inserts a newly created subtask and makes its loaded parent expandable", async () => {
    useTasksStore.setState({
      tasks: [taskRow({ sub_issues_count: 0 })],
      subtasks: {},
      details: { task: taskRow({ sub_issues_count: 0 }) },
    });
    getWorkItem.mockResolvedValue(
      detail(
        workItem({
          id: "child-new",
          key: "MEML-2",
          name: "New implementation",
          parent_id: "task-1",
          sequence_id: 2,
          state: DONE,
          state_revision: 2,
        }),
      ),
    );
    statusFeed.start("project-1");

    dispatchStatusFrame(stateFrame(2, { work_item_id: "child-new" }));

    expect(getWorkItem).toHaveBeenCalledWith(
      "child-new",
      expect.any(AbortSignal),
    );
    await vi.waitFor(() =>
      expect(useTasksStore.getState()).toMatchObject({
        tasks: [{ id: "task-1", sub_issues_count: 1 }],
        subtasks: {
          "task-1": [
            {
              id: "child-new",
              parent_id: "task-1",
              name: "New implementation",
              state: { id: "done" },
            },
          ],
        },
      }),
    );

    dispatchStatusFrame(stateFrame(2, { work_item_id: "child-new" }));
    dispatchStatusFrame(stateFrame(1, { work_item_id: "child-new" }));

    expect(getWorkItem).toHaveBeenCalledTimes(1);
    expect(useTasksStore.getState().subtasks["task-1"]).toHaveLength(1);
    expect(useTasksStore.getState().tasks[0].sub_issues_count).toBe(1);
  });

  it("ignores an unseen subtask whose parent is outside the active module tree", () => {
    const result = useTasksStore.getState().reconcileTargetedTask(
      workItem({
        id: "child-elsewhere",
        key: "MEML-3",
        parent_id: "other-parent",
        sequence_id: 3,
        state_revision: 2,
      }),
      2,
    );

    expect(result).toBe("ignored");
    expect(useTasksStore.getState().subtasks["other-parent"]).toBeUndefined();
    expect(
      useTasksStore
        .getState()
        .tasks.some((task) => task.id === "child-elsewhere"),
    ).toBe(false);
  });

  it("ignores an unseen subtask detail that returns after a module switch", async () => {
    const pendingDetail = deferred<WorkItemDetail>();
    getWorkItem.mockReturnValue(pendingDetail.promise);
    statusFeed.start("project-1");

    dispatchStatusFrame(stateFrame(2, { work_item_id: "child-new" }));
    await vi.waitFor(() => expect(getWorkItem).toHaveBeenCalledTimes(1));

    useTasksStore.setState({
      selectedModuleId: "module-2",
      tasks: [taskRow({ id: "task-2" })],
      subtasks: {},
      details: null,
    });
    pendingDetail.resolve(
      detail(
        workItem({
          id: "child-new",
          key: "MEML-2",
          parent_id: "task-1",
          sequence_id: 2,
          state_revision: 2,
        }),
      ),
    );
    await pendingDetail.promise;
    await Promise.resolve();

    expect(useTasksStore.getState().subtasks["task-1"]).toBeUndefined();
    expect(useTasksStore.getState().tasks).toEqual([
      expect.objectContaining({ id: "task-2" }),
    ]);
  });

  it("does not let an in-flight new-subtask detail overwrite a newer loaded row", async () => {
    const pendingDetail = deferred<WorkItemDetail>();
    getWorkItem.mockReturnValue(pendingDetail.promise);
    useTasksStore.setState({
      tasks: [taskRow({ sub_issues_count: 0 })],
      subtasks: {},
      details: { task: taskRow({ sub_issues_count: 0 }) },
    });
    statusFeed.start("project-1");

    dispatchStatusFrame(stateFrame(2, { work_item_id: "child-new" }));
    await vi.waitFor(() => expect(getWorkItem).toHaveBeenCalledTimes(1));

    useTasksStore.setState({
      tasks: [taskRow({ sub_issues_count: 1 })],
      subtasks: {
        "task-1": [
          taskRow({
            id: "child-new",
            name: "Newer child",
            parent_id: "task-1",
            state: DONE,
            state_revision: 3,
          }),
        ],
      },
    });
    pendingDetail.resolve(
      detail(
        workItem({
          id: "child-new",
          key: "MEML-2",
          name: "Stale child",
          parent_id: "task-1",
          sequence_id: 2,
          state: TODO,
          state_revision: 2,
        }),
      ),
    );
    await pendingDetail.promise;
    await Promise.resolve();

    expect(useTasksStore.getState().subtasks["task-1"][0]).toMatchObject({
      name: "Newer child",
      state: { id: "done" },
      state_revision: 3,
    });
  });

  it("keeps an accepted delta over a slower stale loadTasks response", async () => {
    useTasksStore.setState({ tasks: [], subtasks: {}, details: null });
    dispatchStatusFrame(stateFrame(5));

    getTasks.mockResolvedValue({
      tasks: [taskRow({ state: TODO, state_revision: 1 })],
      subtasks: {},
      states: [TODO, DONE],
    });
    await useTasksStore.getState().loadTasks("project-1", "module-1");

    const loaded = useTasksStore
      .getState()
      .tasks.find((task) => task.id === "task-1");
    expect(loaded).toMatchObject({ state: { id: "done" }, state_revision: 5 });
  });

  it("reports a stale targeted detail so the keyed retry refetches", () => {
    dispatchStatusFrame(stateFrame(4));
    const result = useTasksStore
      .getState()
      .reconcileTargetedTask(workItem({ state_revision: 3 }), 4);
    expect(result).toBe("stale");
    expect(useTasksStore.getState().tasks[0].state_revision).toBe(4);
  });

  it("drops a Story deleted behind the feed's back on a 404 reconcile", async () => {
    getWorkItem.mockRejectedValue(
      new client.ApiError(404, "gone", { detail: "gone" }),
    );
    statusFeed.start("project-1");

    dispatchStatusFrame(stateFrame(2));

    await vi.waitFor(() =>
      expect(
        useTasksStore.getState().tasks.some((task) => task.id === "task-1"),
      ).toBe(false),
    );
    expect(useTasksStore.getState().details).toBeNull();
  });
});
