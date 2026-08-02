import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEMP_TASK_ID } from "../features/agents/types";
import * as api from "../features/studio/lib/api";
import type {
  TaskDetails,
  TaskState,
  TaskSummary,
} from "../features/studio/lib/types";
import { TasksPane } from "../features/studio/pages/tasks/TasksPane";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";

vi.mock("../features/agents/lifecycle", () => ({
  AgentStateBadge: () => <span data-testid="agent-lifecycle" />,
  AutomationFailureChicklet: () => null,
  ScratchStateBadge: () => null,
}));

vi.mock("../features/studio/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/studio/lib/api")>()),
  postTaskStatus: vi.fn(),
  updateState: vi.fn(),
}));

const TODO: TaskState = {
  id: "todo",
  name: "Todo",
  group: "backlog",
  color: "#33B1FF",
  sort_order: 0,
};

const REVIEW: TaskState = {
  id: "review",
  name: "Review",
  group: "started",
  color: "#D12771",
  sort_order: 1,
};

const STATELESS: TaskState = {
  id: null,
  name: "No state",
  group: "",
  color: null,
  sort_order: 2,
};

function task(
  id: string,
  state: TaskState,
  parentId: string | null,
  subIssuesCount = 0,
): TaskSummary {
  return {
    id,
    name: `Task ${id}`,
    project_id: "project-1",
    sequence_id: Number(id),
    issue_type: { id: "type-story", name: "Story", level: "task" },
    state,
    description: null,
    parent_id: parentId,
    sub_issues_count: subIssuesCount,
  };
}

function row(taskId: string): HTMLElement {
  const element = document.querySelector(`[data-task-id="${taskId}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing task row ${taskId}`);
  }
  return element;
}

function idToken(taskId: string): HTMLElement {
  const element = row(taskId).querySelector("[data-task-id-token]");
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing task ID token ${taskId}`);
  }
  return element;
}

describe("Studio workflow-state task ID colors", () => {
  beforeEach(() => {
    vi.mocked(api.postTaskStatus).mockReset();
    vi.mocked(api.updateState).mockReset();
    useWorkflowEditorStore.setState({
      projectId: "project-1",
      states: [TODO, REVIEW],
    });
    useUIStore.setState({
      collapsedStateNames: new Set(),
      expandedTaskIds: new Set(["1"]),
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: null,
      tasks: [],
      states: [TODO, REVIEW, STATELESS],
      subtasks: {},
      details: null,
      loading: {
        projects: false,
        modules: false,
        tasks: false,
        details: false,
        subtasks: false,
      },
    });
  });

  it("colors only real task ID tokens while preserving tree geometry and lifecycle indicators", () => {
    const branch = task("1", TODO, "module-1", 1);
    const nestedLeaf = task("2", REVIEW, "1");
    const rootLeaf = task("3", REVIEW, "module-1");
    useTasksStore.setState({
      tasks: [branch, rootLeaf],
      subtasks: { "1": [nestedLeaf] },
    });

    render(<TasksPane />);

    expect(idToken("1")).toHaveStyle({ color: "#33B1FF" });
    expect(idToken("2")).toHaveStyle({ color: "#D12771" });
    expect(idToken("3")).toHaveStyle({ color: "#D12771" });
    expect(idToken("1")).toHaveTextContent("1");
    expect(idToken("1")).not.toHaveAttribute("title");
    expect(idToken("1")).not.toHaveAttribute("aria-label");

    const label = screen.getByText("Task 1");
    expect(label).not.toHaveStyle({ color: "#33B1FF" });
    expect(label.parentElement).toHaveClass("truncate");

    expect(row("1")).toHaveStyle({ paddingLeft: "0ch" });
    expect(row("3")).toHaveStyle({ paddingLeft: "0ch" });
    expect(row("2")).toHaveStyle({ paddingLeft: "2ch" });
    expect(row("1").firstElementChild).toHaveClass("w-4");
    expect(row("3").firstElementChild).toHaveClass("w-4");
    expect(screen.getAllByTestId("agent-lifecycle")).toHaveLength(3);
  });

  it("keeps status-less real IDs muted and Scratch without an ID color token", () => {
    const scratch = {
      ...task("0", STATELESS, null),
      id: TEMP_TASK_ID,
      name: "Local scratch workspace",
      sequence_id: null,
    };
    useTasksStore.setState({
      tasks: [scratch, task("4", STATELESS, "module-1")],
    });

    render(<TasksPane />);

    expect(idToken("4")).toHaveClass("text-text-muted");
    expect(idToken("4")).not.toHaveAttribute("style");
    expect(row(TEMP_TASK_ID).querySelector("[data-task-id-token]")).toBeNull();
  });

  it("adopts an edited state color across loaded root, nested, and detail copies without reload", async () => {
    const recolored = { ...TODO, color: "#A855F7" };
    const root = task("1", TODO, "module-1", 1);
    const nested = task("2", TODO, "1");
    vi.mocked(api.updateState).mockResolvedValue(recolored);
    useTasksStore.setState({
      selectedTaskId: "2",
      tasks: [root],
      subtasks: { "1": [nested] },
      details: { task: nested },
    });
    render(<TasksPane />);

    expect(idToken("1")).toHaveStyle({ color: "#33B1FF" });
    expect(idToken("2")).toHaveStyle({ color: "#33B1FF" });

    await act(async () => {
      await useWorkflowEditorStore
        .getState()
        .updateState("todo", { color: "#A855F7" });
    });

    expect(idToken("1")).toHaveStyle({ color: "#A855F7" });
    expect(idToken("2")).toHaveStyle({ color: "#A855F7" });
    expect(useTasksStore.getState().details?.task.state).toEqual(recolored);
  });
});

describe("Studio status-update reconciliation", () => {
  it("reconciles the returned nested task through every loaded child list, details, and the visible row", async () => {
    const parent = task("1", TODO, "module-1", 1);
    const before = task("2", TODO, "1");
    const returned = task("2", REVIEW, "1");
    const details: TaskDetails = { task: before };
    vi.mocked(api.postTaskStatus).mockResolvedValue(returned);
    useUIStore.setState({
      collapsedStateNames: new Set(),
      expandedTaskIds: new Set(["1"]),
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: "2",
      tasks: [parent],
      states: [TODO, REVIEW],
      subtasks: {
        "1": [before],
        "loaded-containing-list": [task("9", TODO, "8"), before],
      },
      details,
    });
    render(<TasksPane />);
    expect(idToken("2")).toHaveStyle({ color: "#33B1FF" });

    await act(async () => {
      await useTasksStore
        .getState()
        .updateTaskStatus("project-1", "2", "review");
    });

    expect(api.postTaskStatus).toHaveBeenCalledWith(
      "project-1",
      "2",
      "review",
    );
    const state = useTasksStore.getState();
    expect(state.subtasks["1"].find((item) => item.id === "2")?.state).toEqual(
      REVIEW,
    );
    expect(
      state.subtasks["loaded-containing-list"].find((item) => item.id === "2")
        ?.state,
    ).toEqual(REVIEW);
    expect(state.details?.task.state).toEqual(REVIEW);
    expect(idToken("2")).toHaveStyle({ color: "#D12771" });
  });

  it("reconciles a returned top-level Story", async () => {
    const before = task("5", TODO, "module-1");
    const returned = task("5", REVIEW, "module-1");
    vi.mocked(api.postTaskStatus).mockResolvedValue(returned);
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: "5",
      tasks: [before],
      states: [TODO, REVIEW],
      subtasks: {},
      details: null,
    });

    await useTasksStore
      .getState()
      .updateTaskStatus("project-1", "5", "review");

    expect(useTasksStore.getState().tasks).toEqual([returned]);
  });
});
