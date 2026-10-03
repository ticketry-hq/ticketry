import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SprintsList from "../features/sprints/SprintsList";
import { graphOf, sprint } from "../features/planning-graph/testGraph";

it("[overhaul-414] keeps a newly opened completion dialog when an older start request finishes", async () => {
  let finishStart: (value: boolean) => void = () => {};
  const onUpdateSprint = vi.fn(() => new Promise<boolean>((resolve) => { finishStart = resolve; }));
  const props = {
    openStoryId: null,
    onOpenStory: vi.fn(),
    onOpenSprint: vi.fn(),
    onCreateSprint: vi.fn(async () => null),
    onUpdateSprint,
    renderSprintGoals: () => null,
    renderSuggestionAgentBox: () => null,
  };
  const { rerender } = render(<SprintsList {...props} graph={graphOf([], [sprint({ id: "s", name: "Delivery" })])} />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Start Delivery" })).getByRole("button", { name: "Start sprint" }));
  expect(onUpdateSprint).toHaveBeenCalledWith({ id: "s", status: "active" });
  rerender(<SprintsList {...props} graph={graphOf([], [sprint({ id: "s", name: "Delivery", status: "active" })])} />);
  expect(screen.queryByRole("dialog", { name: "Start Delivery" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Complete" }));
  expect(screen.getByRole("dialog", { name: "Complete Delivery" })).toBeInTheDocument();
  await act(async () => { finishStart(true); });
  expect(screen.getByRole("dialog", { name: "Complete Delivery" })).toBeInTheDocument();
});
