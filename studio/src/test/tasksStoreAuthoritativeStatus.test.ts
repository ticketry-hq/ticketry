import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskState, TaskSummary } from "../features/studio/lib/types";
import { useTasksStore } from "../features/studio/stores/tasksStore";

const api = vi.hoisted(() => ({ postTaskStatus: vi.fn() }));

vi.mock("../features/studio/lib/api", async (load) => ({
  ...(await load<typeof import("../features/studio/lib/api")>()),
  ...api,
}));

const STALE_REVIEW: TaskState = {
  id: "review",
  name: "Review",
  group: "started",
  color: "#7dcfff",
  sort_order: 2,
};

function task(state: TaskState): TaskSummary {
  return {
    id: "task-1",
    name: "Story",
    project_id: "project-1",
    sequence_id: 1,
    issue_type: { id: "type-story", name: "Story", level: "task" },
    state,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
  };
}

describe("Studio authoritative status transition", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useTasksStore.setState({
      selectedProjectId: "project-1",
      states: [STALE_REVIEW],
      tasks: [task(STALE_REVIEW)],
      subtasks: {},
      details: null,
    });
  });

  it("delegates state selection to the authoritative server write", async () => {
    const authoritative = { ...STALE_REVIEW, group: "completed" };
    api.postTaskStatus.mockResolvedValue(task(authoritative));

    await useTasksStore
      .getState()
      .updateTaskStatus("project-1", "task-1", "review");

    expect(api.postTaskStatus).toHaveBeenCalledWith(
      "project-1",
      "task-1",
      "review",
    );
  });
});
