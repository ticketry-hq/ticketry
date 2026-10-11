import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PlanStoryPanes } from "../features/sprints/planning/PlanStoryPanes";
import { workItem } from "../features/planning-graph/testGraph";

it("[overhaul-814] keyboard handoffs survive disabled move controls while deliberate focus and final-row fallback remain authoritative", () => {
  const stories = ["first", "second"].map((id) => workItem({ id }));
  const panes = (remaining: typeof stories, ready: boolean) => <>
    <button type="button">Other control</button>
    <PlanStoryPanes sprintName="Release" activeEpicId="a"
      backlog={[{ epic: { id: "a", name: "Auth" }, items: remaining }]} sprintPane={[]}
      canMove={() => ready} isPending={() => false} openStory={vi.fn()} request={vi.fn()} />
  </>;
  const view = render(panes(stories, true));
  const backlog = within(screen.getByTestId("plan-backlog"));
  const moveFirst = () => {
    const title = backlog.getByRole("button", { name: "PLAN-first first" });
    title.focus();
    fireEvent.keyDown(title, { key: "ArrowDown", altKey: true });
  };
  moveFirst();
  view.rerender(panes(stories.slice(1), false));
  const next = backlog.getByRole("button", { name: "Plan PLAN-second into sprint" });
  expect(next).toBeDisabled();
  expect(backlog.getByRole("heading", { name: "Backlog" })).toHaveFocus();
  view.rerender(panes(stories.slice(1), true));
  expect(next).toHaveFocus();
  // A later refresh may disable a successfully focused handoff as well.
  view.rerender(panes(stories.slice(1), false));
  expect(backlog.getByRole("heading", { name: "Backlog" })).toHaveFocus();
  view.rerender(panes(stories.slice(1), true));
  expect(next).toHaveFocus();

  view.rerender(panes(stories, true));
  moveFirst();
  view.rerender(panes(stories.slice(1), false));
  const outside = screen.getByRole("button", { name: "Other control" });
  fireEvent.pointerDown(outside);
  outside.focus();
  view.rerender(panes(stories.slice(1), true));
  expect(outside).toHaveFocus();

  const last = backlog.getByRole("button", { name: "PLAN-second second" });
  last.focus();
  fireEvent.keyDown(last, { key: "ArrowDown", altKey: true });
  view.rerender(panes([], true));
  expect(backlog.getByRole("heading", { name: "Backlog" })).toHaveFocus();
});
