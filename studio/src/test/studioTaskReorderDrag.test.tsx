import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskState, TaskSummary } from "../features/studio/lib/types";
import { TasksPane } from "../features/studio/pages/tasks/TasksPane";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";

const api = vi.hoisted(() => ({
  postTaskStatus: vi.fn(),
  putExpandedSubtasks: vi.fn(),
  reorderTask: vi.fn(),
}));

vi.mock("../features/studio/lib/api", async (load) => ({
  ...(await load<typeof import("../features/studio/lib/api")>()),
  ...api,
}));

vi.mock("../features/agents/lifecycle", () => ({
  AgentStateBadge: () => null,
  AutomationFailureChicklet: () => null,
  ScratchStateBadge: () => null,
}));

const TODO: TaskState = {
  id: "todo",
  name: "Todo",
  group: "unstarted",
  color: null,
  sort_order: 0,
};
const REVIEW: TaskState = {
  id: "review",
  name: "Review",
  group: "started",
  color: null,
  sort_order: 1,
};

function task(
  id: string,
  rank: string,
  parentId = "module-1",
  childCount = 0,
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
    parent_id: parentId,
    sub_issues_count: childCount,
    state_revision: 1,
  };
}

function dataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    get types() {
      return [...values.keys()];
    },
    clearData(type?: string) {
      if (type) values.delete(type);
      else values.clear();
    },
    getData: (type: string) => values.get(type) ?? "",
    setData(type: string, value: string) {
      values.set(type, value);
    },
    setDragImage: vi.fn(),
  };
}

function visibleRows(): string[] {
  return within(screen.getByRole("tree"))
    .getAllByRole("treeitem")
    .map((row) => row.getAttribute("data-task-id")!);
}

function dispatchDrag(
  target: Element,
  type: string,
  transfer: DataTransfer,
  clientY = 0,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    clientY: { value: clientY },
  });
  fireEvent(target, event);
}

describe("TasksPane within-state ticket dragging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useUIStore.setState({
      collapsedStateNames: new Set(),
      expandedTaskIds: new Set(["middle"]),
      storySearchQuery: "",
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: null,
      tasks: [
        task("top", "Z"),
        task("middle", "M", "module-1", 1),
        task("bottom", "A"),
      ],
      states: [TODO, REVIEW],
      subtasks: {
        middle: [task("middle-child", "V", "middle")],
      },
      details: null,
      loading: {
        projects: false,
        modules: false,
        tasks: false,
        details: false,
        subtasks: false,
      },
      pendingReorderTaskIds: new Set(),
    });
  });

  it("targets a descendant's root-block seam, clears on cancel, and drops there", async () => {
    api.reorderTask.mockResolvedValue(task("bottom", "T"));
    render(<TasksPane />);

    const source = screen.getByRole("treeitem", { name: /bottom/ });
    const child = screen.getByRole("treeitem", { name: /middle-child/ });
    const targetBlock = child.closest("li[role='none']") as HTMLElement;
    vi.spyOn(targetBlock, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 100,
      height: 100,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const transfer = dataTransfer();

    dispatchDrag(source, "dragstart", transfer);
    dispatchDrag(child, "dragover", transfer, 25);

    expect(screen.getAllByTestId("ticket-drop-seam")).toHaveLength(1);
    expect(screen.getByTestId("ticket-drop-seam")).toHaveClass("top-0");
    expect(visibleRows()).toEqual([
      "top",
      "middle",
      "middle-child",
      "bottom",
    ]);

    dispatchDrag(source, "dragend", transfer);
    expect(screen.queryByTestId("ticket-drop-seam")).not.toBeInTheDocument();

    dispatchDrag(source, "dragstart", transfer);
    dispatchDrag(child, "dragover", transfer, 25);
    dispatchDrag(child, "drop", transfer, 25);

    await waitFor(() =>
      expect(api.reorderTask).toHaveBeenCalledWith(
        "bottom",
        "middle",
        "top",
      ),
    );
    expect(visibleRows()).toEqual([
      "top",
      "bottom",
      "middle",
      "middle-child",
    ]);
    expect(screen.queryByTestId("ticket-drop-seam")).not.toBeInTheDocument();
    expect(child).not.toHaveAttribute("draggable");
  });

  it("removes every drag source while stories search is active", () => {
    useUIStore.setState({ storySearchQuery: "top" });
    render(<TasksPane />);

    const top = screen.getByRole("treeitem", { name: /top/ });
    expect(top).not.toHaveAttribute("draggable");

    fireEvent.change(screen.getByRole("textbox", { name: "Search stories" }), {
      target: { value: "" },
    });
    expect(top).toHaveAttribute("draggable", "true");
    expect(
      screen.getByRole("treeitem", { name: /middle-child/ }),
    ).toBeInTheDocument();
  });

  it("drops on an empty collapsed header without expanding it", async () => {
    const calls: string[] = [];
    useUIStore.setState({ collapsedStateNames: new Set(["Review"]) });
    api.postTaskStatus.mockImplementation(async () => {
      calls.push("transition");
      return task("bottom", "A", "module-1", 0, REVIEW);
    });
    api.reorderTask.mockImplementation(async () => {
      calls.push("reorder");
      return task("bottom", "M", "module-1", 0, REVIEW);
    });
    render(<TasksPane />);

    const source = screen.getByRole("treeitem", { name: /bottom/ });
    const header = screen.getByRole("button", { name: "Expand Review" });
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 40,
      height: 40,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const transfer = dataTransfer();

    dispatchDrag(source, "dragstart", transfer);
    dispatchDrag(header, "dragover", transfer, 20);
    expect(screen.getByTestId("ticket-drop-seam")).toBeInTheDocument();
    dispatchDrag(header, "drop", transfer, 20);

    await waitFor(() => expect(calls).toEqual(["transition", "reorder"]));
    expect(api.postTaskStatus).toHaveBeenCalledWith(
      "project-1",
      "bottom",
      "review",
      true,
    );
    expect(api.reorderTask).toHaveBeenCalledWith("bottom", null, null);
    expect(
      screen.getByRole("button", { name: "Expand Review" }),
    ).toHaveTextContent("Review1");
    expect(
      screen.queryByRole("treeitem", { name: /bottom/ }),
    ).not.toBeInTheDocument();
    expect(useTasksStore.getState().selectedTaskId).toBe("bottom");
  });

  it("transiently collapses only the dragged root and restores it on every drag end path", async () => {
    useUIStore.setState({
      expandedModuleId: "module-1",
      expandedTaskIds: new Set(["top", "middle"]),
    });
    useTasksStore.setState({
      tasks: [
        task("top", "Z", "module-1", 1),
        task("middle", "M", "module-1", 1),
        task("bottom", "A"),
      ],
      subtasks: {
        top: [task("top-child", "Y", "top")],
        middle: [task("middle-child", "V", "middle")],
      },
    });
    const persistedBefore = JSON.stringify([
      ...useUIStore.getState().expandedTaskIds,
    ]);
    render(<TasksPane />);

    const transfer = dataTransfer();
    const middle = screen.getByRole("treeitem", { name: /middle$/ });
    const top = screen.getByRole("treeitem", { name: /top$/ });
    const bottom = screen.getByRole("treeitem", { name: /bottom$/ });
    const bottomBlock = bottom.closest("li[role='none']") as HTMLElement;
    vi.spyOn(bottomBlock, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 100,
      height: 100,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Native cancellation (dragend).
    dispatchDrag(middle, "dragstart", transfer);
    expect(screen.queryByRole("treeitem", { name: /middle-child/ }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /top-child/ }))
      .toBeInTheDocument();
    dispatchDrag(middle, "dragend", transfer);
    expect(screen.getByRole("treeitem", { name: /middle-child/ }))
      .toBeInTheDocument();

    // Escape cancellation.
    dispatchDrag(middle, "dragstart", transfer);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("treeitem", { name: /middle-child/ }))
      .toBeInTheDocument();

    // Successful drop.
    api.reorderTask.mockResolvedValueOnce(task("middle", "0", "module-1", 1));
    dispatchDrag(middle, "dragstart", transfer);
    dispatchDrag(bottom, "dragover", transfer, 75);
    dispatchDrag(bottom, "drop", transfer, 75);
    expect(screen.getByRole("treeitem", { name: /middle-child/ }))
      .toBeInTheDocument();
    await waitFor(() => expect(api.reorderTask).toHaveBeenCalledTimes(1));

    // Failed move.
    api.reorderTask.mockRejectedValueOnce(new Error("placement failed"));
    dispatchDrag(middle, "dragstart", transfer);
    const topBlock = top.closest("li[role='none']") as HTMLElement;
    vi.spyOn(topBlock, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 100,
      height: 100,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    dispatchDrag(top, "dragover", transfer, 25);
    dispatchDrag(top, "drop", transfer, 25);
    expect(screen.getByRole("treeitem", { name: /middle-child/ }))
      .toBeInTheDocument();
    await waitFor(() => expect(api.reorderTask).toHaveBeenCalledTimes(2));

    expect(JSON.stringify([...useUIStore.getState().expandedTaskIds]))
      .toBe(persistedBefore);
    expect(api.putExpandedSubtasks).not.toHaveBeenCalled();
  });

  it("leaves a previously collapsed dragged root collapsed", () => {
    useUIStore.setState({
      expandedModuleId: "module-1",
      expandedTaskIds: new Set(),
    });
    render(<TasksPane />);

    const middle = screen.getByRole("treeitem", { name: /middle$/ });
    const transfer = dataTransfer();
    dispatchDrag(middle, "dragstart", transfer);
    expect(screen.queryByRole("treeitem", { name: /middle-child/ }))
      .not.toBeInTheDocument();
    dispatchDrag(middle, "dragend", transfer);
    expect(screen.queryByRole("treeitem", { name: /middle-child/ }))
      .not.toBeInTheDocument();
    expect(useUIStore.getState().expandedTaskIds).toEqual(new Set());
    expect(api.putExpandedSubtasks).not.toHaveBeenCalled();
  });
});
