import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanStoryPanes } from "../features/sprints/planning/PlanStoryPanes";
import { workItem } from "../features/planning-graph/testGraph";

describe("Plan story panes acceptance", () => {
  it("[overhaul-443] opens selected tickets, moves with buttons and Alt arrows, and dims other epic stories", () => {
    const openStory = vi.fn(); const request = vi.fn();
    render(<PlanStoryPanes sprintName="Sprint 1" activeEpicId="a" openStoryId="first"
      backlog={[{ epic: { id: "a", name: "Auth" }, items: [workItem({ id: "first" })] }]}
      sprintPane={[{ epic: { id: "b", name: "API" }, items: [workItem({ id: "second" })] }]}
      isPending={() => false} openStory={openStory} request={request} suggestions={<p>Suggested story</p>} />);
    fireEvent.click(screen.getByRole("button", { name: "PLAN-first first" }));
    expect(openStory).toHaveBeenCalledWith("first");
    fireEvent.click(screen.getByRole("button", { name: "Plan PLAN-first into sprint" }));
    expect(request).toHaveBeenCalledWith("first", true);
    fireEvent.keyDown(screen.getByTestId("plan-item-PLAN-second"), { key: "ArrowUp", altKey: true });
    expect(request).toHaveBeenCalledWith("second", false);
    expect(screen.getByTestId("plan-item-PLAN-second").parentElement).toHaveClass("opacity-50");
    expect(screen.getByText("Suggested story")).toBeVisible();
  });

  it("[overhaul-583] keyboard moves from story titles retain next, previous, and empty-pane focus without stealing pointer focus", () => {
    const request = vi.fn();
    const stories = ["first", "second", "third"].map((id) => workItem({ id }));
    const panes = (remaining: typeof stories) => <>
      <button type="button">Other control</button>
      <PlanStoryPanes sprintName="Sprint 1" activeEpicId="a"
        backlog={[{ epic: { id: "a", name: "Auth" }, items: remaining }]}
        sprintPane={[]} isPending={() => false} openStory={() => {}} request={request} />
    </>;
    const view = render(panes(stories));
    const backlog = within(screen.getByTestId("plan-backlog"));
    const keyboardMove = (id: string) => {
      const title = backlog.getByRole("button", { name: `PLAN-${id} ${id}` });
      title.focus();
      fireEvent.keyDown(title, { key: "ArrowDown", altKey: true });
      expect(request).toHaveBeenLastCalledWith(id, true);
    };
    keyboardMove("first");
    view.rerender(panes(stories.slice(1)));
    expect(backlog.getByRole("button", { name: "Plan PLAN-second into sprint" })).toHaveFocus();
    keyboardMove("third");
    view.rerender(panes([stories[1]]));
    expect(backlog.getByRole("button", { name: "Plan PLAN-second into sprint" })).toHaveFocus();
    keyboardMove("second");
    view.rerender(panes([]));
    expect(backlog.getByRole("heading", { name: "Backlog" })).toHaveFocus();
    view.rerender(panes(stories));
    const outside = screen.getByRole("button", { name: "Other control" });
    outside.focus();
    fireEvent.click(backlog.getByRole("button", { name: "Plan PLAN-first into sprint" }), { detail: 1 });
    view.rerender(panes(stories.slice(1)));
    expect(outside).toHaveFocus();
  });
});
