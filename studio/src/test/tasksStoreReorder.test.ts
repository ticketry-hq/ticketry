import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../shared/api/client";
import type { TaskState, TaskSummary } from "../features/studio/lib/types";
import { useToastStore } from "../app/stores/toastStore";

const api = vi.hoisted(() => ({
  getTasks: vi.fn(),
  postTaskStatus: vi.fn(),
  reorderTask: vi.fn(),
}));

vi.mock("../features/studio/lib/api", async (load) => ({
  ...(await load<typeof import("../features/studio/lib/api")>()),
  ...api,
}));

import { useTasksStore } from "../features/studio/stores/tasksStore";

const TODO: TaskState = {
  id: "todo",
  name: "Todo",
  group: "unstarted",
  color: null,
  sort_order: 1,
};
const REVIEW: TaskState = {
  id: "review",
  name: "Review",
  group: "started",
  color: null,
  sort_order: 2,
};

function task(
  id: string,
  rank: string,
  revision = 1,
  updatedAt = "2026-07-28T00:00:00Z",
  state = TODO,
): TaskSummary {
  return {
    id,
    name: id,
    project_id: "project-1",
    sequence_id: 1,
    rank,
    state,
    assignees: [],
    labels: [],
    description_html: null,
    description_stripped: null,
    description: null,
    parent_id: "module-1",
    sub_issues_count: 0,
    state_revision: revision,
    updated_at: updatedAt,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("tasksStore moveTaskWithinState", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useToastStore.setState({ toasts: [] });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      tasks: [task("low", "A"), task("move", "M"), task("high", "Z")],
      states: [TODO],
      subtasks: { parent: [task("move", "M")] },
      details: { task: task("move", "M") } as never,
      selectedTaskId: null,
      seenStateRevisions: {},
      pendingStateDeltas: {},
      pendingReorderTaskIds: new Set(),
    });
  });

  it("transitions before placing a cross-state move", async () => {
    const calls: string[] = [];
    const child = task("child", "child-rank");
    useTasksStore.setState((state) => ({
      subtasks: { ...state.subtasks, move: [child] },
    }));
    api.postTaskStatus.mockImplementation(async () => {
      calls.push("transition");
      return task("move", "M", 2, "2026-07-28T00:01:00Z", REVIEW);
    });
    api.reorderTask.mockImplementation(async () => {
      calls.push("reorder");
      return task("move", "Y", 2, "2026-07-28T00:02:00Z", REVIEW);
    });

    await expect(
      useTasksStore
        .getState()
        .moveTaskToState("move", REVIEW, null, null),
    ).resolves.toBe(true);

    expect(calls).toEqual(["transition", "reorder"]);
    expect(api.postTaskStatus).toHaveBeenCalledWith(
      "project-1",
      "move",
      "review",
      true,
    );
    expect(api.reorderTask).toHaveBeenCalledWith("move", null, null);
    expect(
      useTasksStore.getState().tasks.find((item) => item.id === "move")!.state,
    ).toEqual(REVIEW);
    expect(useTasksStore.getState().selectedTaskId).toBe("move");
    expect(useTasksStore.getState().subtasks.move[0]).toEqual(child);
  });

  it("restores a refused transition and surfaces the gate detail verbatim", async () => {
    api.postTaskStatus.mockRejectedValue(
      new ApiError(422, "Unprocessable Entity", {
        detail: "A Story cannot move 'Todo' → 'Review'.",
        code: "illegal_transition",
        from: "todo",
        to: "review",
      }),
    );

    await expect(
      useTasksStore
        .getState()
        .moveTaskToState("move", REVIEW, null, null),
    ).resolves.toBe(false);

    const restored = useTasksStore
      .getState()
      .tasks.find((item) => item.id === "move")!;
    expect(restored.state).toEqual(TODO);
    expect(restored.rank).toBe("M");
    expect(useTasksStore.getState().selectedTaskId).toBe("move");
    expect(api.reorderTask).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      "A Story cannot move 'Todo' → 'Review'.",
    );
  });

  it("does not roll back over a newer authoritative state revision", async () => {
    const request = deferred<TaskSummary>();
    api.postTaskStatus.mockReturnValue(request.promise);
    const moving = useTasksStore
      .getState()
      .moveTaskToState("move", REVIEW, null, null);

    useTasksStore.getState().applyWorkItemStateDelta(
      "move",
      {
        id: "done",
        name: "Done",
        group: "completed",
        color: null,
        sort_order: 3,
      },
      3,
    );
    request.reject(
      new ApiError(422, "Unprocessable Entity", {
        detail: "Transition refused.",
      }),
    );
    await moving;

    expect(
      useTasksStore.getState().tasks.find((item) => item.id === "move")!.state
        .name,
    ).toBe("Done");
    expect(useTasksStore.getState().selectedTaskId).toBe("move");
    expect(api.reorderTask).not.toHaveBeenCalled();
  });

  it("keeps an accepted state, refreshes rank, and reports placement failure", async () => {
    api.postTaskStatus.mockResolvedValue(
      task("move", "M", 2, "2026-07-28T00:01:00Z", REVIEW),
    );
    api.reorderTask.mockRejectedValue(
      new ApiError(500, "rank write failed", null),
    );
    api.getTasks.mockResolvedValue({
      tasks: [
        task("low", "A"),
        task("move", "server-rank", 2, "2026-07-28T00:02:00Z", REVIEW),
        task("high", "Z"),
      ],
      states: [TODO, REVIEW],
      subtasks: {},
    });

    await expect(
      useTasksStore
        .getState()
        .moveTaskToState("move", REVIEW, null, null),
    ).resolves.toBe(false);

    const retained = useTasksStore
      .getState()
      .tasks.find((item) => item.id === "move")!;
    expect(retained.state).toEqual(REVIEW);
    expect(retained.rank).toBe("server-rank");
    expect(api.postTaskStatus).toHaveBeenCalledTimes(1);
    expect(api.getTasks).toHaveBeenCalledWith("project-1", "module-1");
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain(
      "Ticket moved, but placement failed",
    );
  });

  it("optimistically updates every copy, sends ids, then reconciles", async () => {
    const request = deferred<TaskSummary>();
    api.reorderTask.mockReturnValue(request.promise);

    const moving = useTasksStore
      .getState()
      .moveTaskWithinState("move", "high", null);

    expect(
      useTasksStore.getState().tasks.find((item) => item.id === "move")!.rank! >
        "Z",
    ).toBe(true);
    expect(useTasksStore.getState().subtasks.parent[0].rank! > "Z").toBe(true);
    expect(useTasksStore.getState().details!.task.rank! > "Z").toBe(true);
    expect(api.reorderTask).toHaveBeenCalledWith("move", "high", null);
    expect(useTasksStore.getState().pendingReorderTaskIds.has("move")).toBe(
      true,
    );

    request.resolve(task("move", "z"));
    await expect(moving).resolves.toBe(true);
    expect(
      useTasksStore.getState().tasks.find((item) => item.id === "move")!.rank,
    ).toBe("z");
    expect(useTasksStore.getState().pendingReorderTaskIds.has("move")).toBe(
      false,
    );
  });

  it("restores the prior rank and surfaces a failed reorder", async () => {
    api.reorderTask.mockRejectedValue(
      new ApiError(422, "placement rejected", null),
    );

    await expect(
      useTasksStore.getState().moveTaskWithinState("move", "high", null),
    ).resolves.toBe(false);

    expect(
      useTasksStore.getState().tasks.find((item) => item.id === "move")!.rank,
    ).toBe("M");
    expect(useTasksStore.getState().subtasks.parent[0].rank).toBe("M");
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain(
      "placement rejected",
    );
  });

  it("keeps a newer authoritative copy when the request later fails", async () => {
    const request = deferred<TaskSummary>();
    api.reorderTask.mockReturnValue(request.promise);
    const moving = useTasksStore
      .getState()
      .moveTaskWithinState("move", "high", null);

    useTasksStore.setState((state) => ({
      tasks: state.tasks.map((item) =>
        item.id === "move"
          ? task("move", "authoritative", 1, "2026-07-28T00:01:00Z")
          : item,
      ),
    }));
    request.reject(new Error("late failure"));
    await moving;

    expect(
      useTasksStore.getState().tasks.find((item) => item.id === "move")!.rank,
    ).toBe("authoritative");
  });

  it("suppresses unchanged and duplicate in-flight moves", async () => {
    await expect(
      useTasksStore.getState().moveTaskWithinState("move", "low", "high"),
    ).resolves.toBe(false);
    expect(api.reorderTask).not.toHaveBeenCalled();

    const request = deferred<TaskSummary>();
    api.reorderTask.mockReturnValue(request.promise);
    const first = useTasksStore
      .getState()
      .moveTaskWithinState("move", "high", null);
    await expect(
      useTasksStore.getState().moveTaskWithinState("move", null, "low"),
    ).resolves.toBe(false);
    expect(api.reorderTask).toHaveBeenCalledTimes(1);
    request.resolve(task("move", "z"));
    await first;
  });

  it("does not apply a response after the module tree changes", async () => {
    const request = deferred<TaskSummary>();
    api.reorderTask.mockReturnValue(request.promise);
    const moving = useTasksStore
      .getState()
      .moveTaskWithinState("move", "high", null);

    useTasksStore.setState({
      selectedModuleId: "module-2",
      tasks: [task("other", "Q")],
      subtasks: {},
      details: null,
    });
    request.resolve(task("move", "z"));
    await moving;

    expect(useTasksStore.getState().tasks.map((item) => item.id)).toEqual([
      "other",
    ]);
  });
});
