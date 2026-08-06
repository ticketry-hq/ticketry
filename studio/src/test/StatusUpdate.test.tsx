import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "../app/modal";
import { StatusUpdate } from "../features/studio/modals/StatusUpdate";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import StatePicker from "../app/shell/ticket-workspace/selected-ticket/details/fields/StatePicker";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import { seedStates, setStatesSorted } from "../shared/query/stateCatalog";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";
import * as api from "../shared/api/client";
import type { WorkItem } from "../shared/api/types";

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  patchWorkItem: vi.fn(),
}));

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
    });
    useBacklogStore.setState({
      projectId: "project-1",
      states: [TODO, REVIEW, DONE],
    });
    seedStates("project-1", [TODO, REVIEW, DONE]);
    const selected = {
      id: "task-1",
      project_id: "project-1",
      state: TODO,
    } as unknown as WorkItem;
    queryClient.setQueryData(queryKeys.workItems.byId(selected.id), selected);
    vi.mocked(api.patchWorkItem).mockReset().mockImplementation(
      async (_id, patch) => ({
        ...selected,
        state: [TODO, REVIEW, DONE].find((state) => state.id === patch.state_id) ?? TODO,
      }),
    );
  });

  const renderWithClient = (node: React.ReactNode) =>
    render(
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
    );

  it("follows the new order while preserving the selected state", async () => {
    renderWithClient(<StatusUpdate />);
    const dialog = screen.getByRole("dialog", { name: "Set Status" });

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(screen.getByText("Review").closest("li")).toHaveClass(
      "bg-selection-bg",
    );

    act(() => {
      setStatesSorted("project-1", [
        { ...REVIEW, sort_order: 0 },
        { ...TODO, sort_order: 1 },
        DONE,
      ]);
    });

    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["Review", "Todo", "Done"]);
    expect(screen.getByText("Review").closest("li")).toHaveClass(
      "bg-selection-bg",
    );

    fireEvent.keyDown(dialog, { key: "Enter" });

    await waitFor(() =>
      expect(api.patchWorkItem).toHaveBeenCalledWith("task-1", {
        state_id: "review",
      }),
    );
  });

  it("reorders an open IssueDetail StatePicker without losing its selection", () => {
    render(<StatePicker projectId="project-1" value={TODO} onChange={vi.fn()} />);
    const picker = screen.getByTestId("state-picker");
    fireEvent.click(within(picker).getByRole("button", { name: "Todo" }));

    act(() => {
      setStatesSorted("project-1", [
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
    renderWithClient(<StatusUpdate />);
    const reviewRow = screen.getByText("Review").closest("li");
    expect(reviewRow).not.toBeNull();

    act(() => {
      seedStates("project-1", [TODO, DONE]);
      fireEvent.click(reviewRow as HTMLLIElement);
    });

    expect(api.patchWorkItem).not.toHaveBeenCalled();
  });

  it("does not submit a state removed before an open StatePicker rerenders", () => {
    const onChange = vi.fn();
    render(<StatePicker projectId="project-1" value={TODO} onChange={onChange} />);
    const picker = screen.getByTestId("state-picker");
    fireEvent.click(within(picker).getByRole("button", { name: "Todo" }));
    const reviewOption = within(picker).getByRole("button", { name: "Review" });

    act(() => {
      seedStates("project-1", [TODO, DONE]);
      fireEvent.click(reviewOption);
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
