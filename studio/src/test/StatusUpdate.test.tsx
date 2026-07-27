import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "../app/modal";
import { StatusUpdate } from "../features/studio/modals/StatusUpdate";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import StatePicker from "../features/work-items/fields/StatePicker";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import { synchronizeActiveStateCatalogOrder } from "../features/workflows/stateCatalogSync";

const TODO = {
  id: "todo",
  name: "Todo",
  group: "unstarted",
  color: null,
  sort_order: 0,
};
const REVIEW = {
  id: "review",
  name: "Review",
  group: "started",
  color: null,
  sort_order: 1,
};
const DONE = {
  id: "done",
  name: "Done",
  group: "completed",
  color: null,
  sort_order: 2,
};

describe("Set Status workflow-state reorder", () => {
  beforeEach(() => {
    useModalStore.setState({
      modalStack: [{ type: "status-update" }],
      activeBindings: null,
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedTaskId: "task-1",
      states: [TODO, REVIEW, DONE],
      updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    });
    useBacklogStore.setState({
      projectId: "project-1",
      states: [TODO, REVIEW, DONE],
    });
  });

  it("follows the new order while preserving the selected state", async () => {
    render(<StatusUpdate />);
    const dialog = screen.getByRole("dialog", { name: "Set Status" });

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(screen.getByText("Review").closest("li")).toHaveClass(
      "bg-selection-bg",
    );

    act(() => {
      useTasksStore.setState({
        states: [
          { ...REVIEW, sort_order: 0 },
          { ...TODO, sort_order: 1 },
          DONE,
        ],
      });
    });

    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["Review", "Todo", "Done"]);
    expect(screen.getByText("Review").closest("li")).toHaveClass(
      "bg-selection-bg",
    );

    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(useTasksStore.getState().updateTaskStatus).toHaveBeenCalledWith(
      "project-1",
      "task-1",
      "review",
    );
  });

  it("reorders an open IssueDetail StatePicker without losing its selection", () => {
    render(<StatePicker value={TODO} onChange={vi.fn()} />);
    const picker = screen.getByTestId("state-picker");
    fireEvent.click(within(picker).getByRole("button", { name: "Todo" }));

    act(() => {
      synchronizeActiveStateCatalogOrder("project-1", [
        { ...REVIEW, sort_order: 0 },
        { ...TODO, sort_order: 1 },
        DONE,
      ]);
    });

    expect(
      within(picker).getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Todo", "Review", "Todo", "Done"]);
    expect(within(picker).getAllByText("Todo")[1].closest("button")).toHaveClass(
      "text-focus-accent",
    );
  });

  it("does not submit a state removed before an open StatusUpdate rerenders", () => {
    render(<StatusUpdate />);
    const reviewRow = screen.getByText("Review").closest("li");
    expect(reviewRow).not.toBeNull();

    act(() => {
      useTasksStore.setState({ states: [TODO, DONE] });
      fireEvent.click(reviewRow as HTMLLIElement);
    });

    expect(useTasksStore.getState().updateTaskStatus).not.toHaveBeenCalled();
  });

  it("does not submit a state removed before an open StatePicker rerenders", () => {
    const onChange = vi.fn();
    render(<StatePicker value={TODO} onChange={onChange} />);
    const picker = screen.getByTestId("state-picker");
    fireEvent.click(within(picker).getByRole("button", { name: "Todo" }));
    const reviewOption = within(picker).getByRole("button", { name: "Review" });

    act(() => {
      useBacklogStore.setState({ states: [TODO, DONE] });
      fireEvent.click(reviewOption);
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
