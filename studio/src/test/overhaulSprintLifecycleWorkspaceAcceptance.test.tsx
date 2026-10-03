import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SprintsList from "../features/sprints/SprintsList";
import { graphOf, sprint, workItem } from "../features/planning-graph/testGraph";

describe("Plan sprint workspace acceptance", () => {
  it("[overhaul-409] starts a planned sprint when the project has no active sprint", async () => {
    const onUpdateSprint = vi.fn(async () => true);
    render(<SprintsList graph={graphOf([], [sprint({ id: "planned", name: "Next delivery" })])}
      openStoryId={null} onOpenStory={vi.fn()} onOpenSprint={vi.fn()}
      onCreateSprint={vi.fn(async () => null)} onUpdateSprint={onUpdateSprint}
      renderSprintGoals={() => null} renderSuggestionAgentBox={() => null} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const dialog = screen.getByRole("dialog", { name: "Start Next delivery" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start sprint" }));
    await waitFor(() => expect(onUpdateSprint).toHaveBeenCalledWith({ id: "planned", status: "active" }));
    expect(onUpdateSprint).toHaveBeenCalledTimes(1);
  });

  it("[overhaul-410] completes an active sprint with unfinished stories carried to a planned sprint", async () => {
    const active = sprint({ id: "active", name: "Current delivery", status: "active" });
    const planned = sprint({ id: "planned", name: "Next delivery" });
    const onUpdateSprint = vi.fn(async () => true);
    render(<SprintsList graph={graphOf([
      workItem({ id: "finished", sprintId: active.id, stateId: "done" }),
      workItem({ id: "remaining", sprintId: active.id, stateId: "implement" }),
    ], [active, planned])} openStoryId={null} onOpenStory={vi.fn()}
      onOpenSprint={vi.fn()} onCreateSprint={vi.fn(async () => null)}
      onUpdateSprint={onUpdateSprint} renderSprintGoals={() => null}
      renderSuggestionAgentBox={() => null} />);
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    const dialog = screen.getByRole("dialog", { name: "Complete Current delivery" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Move 1 unfinished item to" }), { target: { value: "planned" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Complete sprint" }));
    await waitFor(() => expect(onUpdateSprint).toHaveBeenCalledWith({ id: "active", status: "completed", carryoverSprintId: "planned" }));
    expect(onUpdateSprint).toHaveBeenCalledTimes(1);
  });

  it("[overhaul-411] creates a named sprint and opens it in Plan", async () => {
    const onCreateSprint = vi.fn(async () => "created-sprint");
    const onOpenSprint = vi.fn();
    render(<SprintsList graph={graphOf([])} openStoryId={null} onOpenStory={vi.fn()}
      onOpenSprint={onOpenSprint} onCreateSprint={onCreateSprint}
      onUpdateSprint={vi.fn(async () => true)} renderSprintGoals={() => null}
      renderSuggestionAgentBox={() => null} />);
    fireEvent.click(screen.getByRole("button", { name: "New sprint" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Sprint name" }), { target: { value: "  Authentication delivery  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onOpenSprint).toHaveBeenCalledWith("created-sprint"));
    expect(onCreateSprint).toHaveBeenCalledTimes(1);
    expect(onCreateSprint).toHaveBeenCalledWith("Authentication delivery");
  });

  it("[overhaul-412] shows lifecycle cards, counts finished stories and opens a planned sprint", () => {
    const active = sprint({ id: "active", name: "Current delivery", status: "active" });
    const planned = sprint({ id: "planned", name: "Next delivery" });
    const completed = sprint({ id: "completed", name: "Previous delivery", status: "completed" });
    const graph = graphOf([
      workItem({ id: "done", name: "Shipped story", sprintId: active.id, stateId: "done" }),
      workItem({ id: "cancelled", name: "Cancelled story", sprintId: active.id, stateId: "cancelled" }),
      workItem({ id: "unfinished", name: "Work in progress", sprintId: active.id, stateId: "implement" }),
    ], [planned, completed, active]);
    const cancelled = { id: "cancelled", name: "Cancelled", group: "cancelled", color: "#888" };
    graph.states = [...graph.states, cancelled];
    graph.stateById.set(cancelled.id, cancelled);
    const onOpenSprint = vi.fn();
    const onOpenStory = vi.fn();
    render(<SprintsList graph={graph} openStoryId={null} onOpenStory={onOpenStory}
      onOpenSprint={onOpenSprint} onCreateSprint={vi.fn(async () => null)}
      onUpdateSprint={vi.fn(async () => true)}
      renderSprintGoals={(entry) => <div>{entry.name} goals</div>}
      renderSuggestionAgentBox={(entry) => <button>{entry.name} Find stories</button>} />);
    const activeCard = screen.getByRole("heading", { name: "Current delivery" }).closest("section");
    const plannedCard = screen.getByRole("heading", { name: "Next delivery" }).closest("section");
    if (!activeCard || !plannedCard) throw new Error("Sprint headings must belong to cards");
    expect(within(activeCard).getByText("2/3 done")).toBeInTheDocument();
    expect(within(plannedCard).getByRole("button", { name: "Start" })).toBeDisabled();
    expect(within(activeCard).getByText("Current delivery goals")).toBeInTheDocument();
    expect(within(plannedCard).getByRole("button", { name: "Next delivery Find stories" })).toBeInTheDocument();
    expect(screen.getByText("1 completed sprint")).toBeInTheDocument();
    fireEvent.click(within(plannedCard).getByRole("button", { name: "Plan" }));
    expect(onOpenSprint).toHaveBeenCalledWith("planned");
    fireEvent.click(within(activeCard).getByRole("button", { name: /Shipped story/ }));
    expect(onOpenStory).toHaveBeenCalledWith("done");
  });
});
