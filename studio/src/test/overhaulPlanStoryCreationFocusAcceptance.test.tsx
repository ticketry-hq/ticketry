import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkItemInvalidator } from "../features/agents/status/stream/workItemInvalidation";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { mountPlanning, openEpic } from "./planningCreationFixture";

describe("Plan Story creation focus ownership", () => {
  beforeEach(() => usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true));

  it("[overhaul-809] restores the submitting sprint editor without letting another pane's retained draft take focus", async () => {
    const { holdNext, requests } = mountPlanning();
    const backlog = await openEpic();
    fireEvent.click(backlog.getByRole("button", { name: "Add story" }));
    const backlogInput = backlog.getByRole("textbox", { name: "Story title" });
    fireEvent.change(backlogInput, { target: { value: "Saved backlog story" } });
    fireEvent.keyDown(backlogInput, { key: "Enter" });
    await backlog.findByText("Saved backlog story");
    await waitFor(() => expect(backlogInput).toHaveValue(""));
    fireEvent.change(backlogInput, { target: { value: "Retained backlog draft" } });
    const sprint = within(screen.getByTestId("plan-sprint-items"));
    fireEvent.click(sprint.getByRole("button", { name: "Add story" }));
    const sprintInput = sprint.getByRole("textbox", { name: "Story title" });
    const release = holdNext("PlanWorkItem");
    fireEvent.change(sprintInput, { target: { value: "Saved sprint story" } });
    fireEvent.keyDown(sprintInput, { key: "Enter" });
    await waitFor(() => expect(sprintInput).toBeDisabled());
    // Chromium blurs disabled inputs; jsdom needs that native step explicitly.
    sprintInput.blur();
    await waitFor(() => expect(requests.some((request) => request.operation === "PlanWorkItem")).toBe(true));
    const releaseGraph = holdNext("PlanningGraph");
    const invalidator = createWorkItemInvalidator();
    act(() => {
      invalidator.record({ family: "work_item", workItemId: "created-2", projectId: "project-1", moduleId: "module-1",
        itemKind: "task", removed: false, membershipChanged: true, occurredAt: null });
      invalidator.flush();
    });
    await waitFor(() => expect(requests.filter((request) => request.operation === "PlanningGraph").length).toBeGreaterThan(2));
    expect(sprintInput).toBeInTheDocument();
    expect(backlogInput).toBeInTheDocument();
    await act(async () => { releaseGraph(); release(); });
    invalidator.cancel();
    await sprint.findByText("Saved sprint story");
    await waitFor(() => expect(sprintInput).toHaveValue(""));
    expect(backlogInput).toHaveValue("Retained backlog draft");
    await waitFor(() => expect(sprintInput).toHaveFocus());
    expect(requests.filter((request) => request.operation === "CreateWorkTrackerWorkItem")).toHaveLength(2);
    expect(requests.filter((request) => request.operation === "PlanWorkItem")).toHaveLength(1);
  });

  it("[overhaul-810] preserves focus and the other pane's draft when the planner moves away during a pending create", async () => {
    const { holdNext, requests } = mountPlanning();
    const backlog = await openEpic();
    fireEvent.click(backlog.getByRole("button", { name: "Add story" }));
    const backlogInput = backlog.getByRole("textbox", { name: "Story title" });
    fireEvent.change(backlogInput, { target: { value: "Intentional backlog draft" } });
    const sprint = within(screen.getByTestId("plan-sprint-items"));
    fireEvent.click(sprint.getByRole("button", { name: "Add story" }));
    const sprintInput = sprint.getByRole("textbox", { name: "Story title" });
    const release = holdNext("PlanWorkItem");
    fireEvent.change(sprintInput, { target: { value: "Pending sprint story" } });
    fireEvent.keyDown(sprintInput, { key: "Enter" });
    await waitFor(() => expect(sprintInput).toBeDisabled());
    await waitFor(() => expect(requests.some((request) => request.operation === "PlanWorkItem")).toBe(true));
    backlogInput.focus();
    const graphReads = requests.filter((request) => request.operation === "PlanningGraph").length;
    const releaseGraph = holdNext("PlanningGraph");
    const invalidator = createWorkItemInvalidator();
    act(() => {
      invalidator.record({ family: "work_item", workItemId: "created-1", projectId: "project-1", moduleId: "module-1",
        itemKind: "task", removed: false, membershipChanged: true, occurredAt: null });
      invalidator.flush();
    });
    await waitFor(() => expect(requests.filter((request) => request.operation === "PlanningGraph").length).toBeGreaterThan(graphReads));
    expect(backlogInput).toBeInTheDocument();
    expect(backlogInput).toHaveFocus();
    await act(async () => { releaseGraph(); release(); });
    invalidator.cancel();
    await sprint.findByText("Pending sprint story");
    await waitFor(() => expect(sprintInput).toHaveValue(""));
    expect(backlogInput).toHaveValue("Intentional backlog draft");
    expect(backlogInput).toHaveFocus();
    fireEvent.keyDown(backlogInput, { key: "Escape" });
    await waitFor(() => expect(backlog.getByRole("button", { name: "Add story" })).toHaveFocus());
    expect(backlog.queryByRole("textbox", { name: "Story title" })).not.toBeInTheDocument();
    expect(sprintInput).toHaveValue("");
  });
});
