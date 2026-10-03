import { fireEvent, render, screen } from "@testing-library/react";
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
});
