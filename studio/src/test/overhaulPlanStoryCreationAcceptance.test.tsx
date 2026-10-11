import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { mountPlanning, openEpic } from "./planningCreationFixture";

describe("Inline story creation in Plan", () => {
  beforeEach(() => usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true));

  it("[overhaul-536] creates a Story in the active epic's backlog without assigning it to the sprint", async () => {
    const { requests } = mountPlanning();
    const backlog = await openEpic();
    fireEvent.click(backlog.getByRole("button", { name: "Add story" }));
    const input = backlog.getByRole("textbox", { name: "Story title" });
    fireEvent.change(input, { target: { value: "Capture new work" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await backlog.findByText("Capture new work")).toBeVisible();
    await waitFor(() => expect(input).toHaveValue(""));
    expect(requests.filter((request) => request.operation === "CreateWorkTrackerWorkItem").map((request) => request.variables)).toEqual([
      { projectId: "project-1", name: "Capture new work", issueTypeId: "story-type", parentId: "module-1" },
    ]);
    expect(requests.filter((request) => request.operation === "PlanWorkItem")).toEqual([]);
    expect(within(screen.getByTestId("plan-sprint-items")).queryByText("Capture new work")).not.toBeInTheDocument();
  });

  it("[overhaul-537] creates and assigns a Story inline even when the sprint pane is empty", async () => {
    const { requests } = mountPlanning();
    await openEpic();
    const sprint = within(screen.getByTestId("plan-sprint-items"));
    fireEvent.click(sprint.getByRole("button", { name: "Add story" }));
    const input = sprint.getByRole("textbox", { name: "Story title" });
    fireEvent.change(input, { target: { value: "Plan new work" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await sprint.findByText("Plan new work")).toBeVisible();
    await waitFor(() => expect(input).toHaveValue(""));
    expect(requests.filter((request) => request.operation === "PlanWorkItem").map((request) => request.variables)).toEqual([{ id: "created-1", sprintId: "sprint" }]);
    expect(within(screen.getByTestId("plan-backlog")).queryByText("Plan new work")).not.toBeInTheDocument();
  });

  it("[overhaul-538] keeps a rejected create's draft editable and retries only after the planner submits again", async () => {
    const { requests, failNext } = mountPlanning();
    const backlog = await openEpic();
    failNext("CreateWorkTrackerWorkItem", "Title was rejected");
    fireEvent.click(backlog.getByRole("button", { name: "Add story" }));
    const input = backlog.getByRole("textbox", { name: "Story title" });
    fireEvent.change(input, { target: { value: "Preserved draft" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await backlog.findByRole("alert")).toHaveTextContent("Title was rejected");
    expect(input).toHaveValue("Preserved draft");
    expect(input).not.toHaveAttribute("readonly");
    fireEvent.change(input, { target: { value: "Corrected title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await backlog.findByText("Corrected title")).toBeVisible();
    await waitFor(() => expect(input).toHaveValue(""));
    expect(backlog.queryByRole("alert")).not.toBeInTheDocument();
    expect(requests.filter((request) => request.operation === "CreateWorkTrackerWorkItem")).toHaveLength(2);
    expect(requests.filter((request) => request.operation === "PlanWorkItem")).toEqual([]);
  });

  it("[overhaul-539] retains the created Story through epic tab close and reopen and retries assignment without creating twice", async () => {
    const { requests, failNext } = mountPlanning();
    const backlog = await openEpic();
    const sprint = within(screen.getByTestId("plan-sprint-items"));
    failNext("PlanWorkItem", "Sprint is busy");
    fireEvent.click(sprint.getByRole("button", { name: "Add story" }));
    fireEvent.change(sprint.getByRole("textbox", { name: "Story title" }), { target: { value: "Retained story" } });
    fireEvent.keyDown(sprint.getByRole("textbox", { name: "Story title" }), { key: "Enter" });
    expect(await sprint.findByRole("alert")).toHaveTextContent("Sprint is busy");
    expect(await backlog.findByText("Retained story")).toBeVisible();
    expect(sprint.getByRole("textbox", { name: "Story title" })).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("button", { name: "Close Module 1" }));
    expect(sprint.queryByRole("textbox", { name: "Story title" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    fireEvent.click(screen.getByRole("button", { name: "Module 1, 1 backlog stories" }));
    const input = sprint.getByRole("textbox", { name: "Story title" });
    expect(input).toHaveValue("Retained story");
    failNext("PlanWorkItem", "Sprint is still busy");
    fireEvent.click(sprint.getByRole("button", { name: "Retry assignment" }));
    await waitFor(() => expect(sprint.getByRole("alert")).toHaveTextContent("Sprint is still busy"));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await sprint.findByText("Retained story")).toBeVisible();
    await waitFor(() => expect(input).toHaveValue(""));
    expect(sprint.queryByRole("alert")).not.toBeInTheDocument();
    expect(backlog.queryByText("Retained story")).not.toBeInTheDocument();
    expect(requests.filter((request) => request.operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
    expect(requests.filter((request) => request.operation === "PlanWorkItem").map((request) => request.variables)).toEqual([
      { id: "created-1", sprintId: "sprint" }, { id: "created-1", sprintId: "sprint" }, { id: "created-1", sprintId: "sprint" },
    ]);
  });

  it("[overhaul-540] retries a failed view refresh without repeating successful creation or assignment", async () => {
    const { requests, failNext } = mountPlanning();
    await openEpic();
    const sprint = within(screen.getByTestId("plan-sprint-items"));
    failNext("PlanningGraph", "View is offline");
    fireEvent.click(sprint.getByRole("button", { name: "Add story" }));
    const input = sprint.getByRole("textbox", { name: "Story title" });
    fireEvent.change(input, { target: { value: "Already saved" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await sprint.findByRole("alert")).toHaveTextContent("View is offline");
    expect(input).toHaveValue("Already saved");
    expect(input).toHaveAttribute("readonly");
    expect(sprint.queryByText("Already saved")).not.toBeInTheDocument();
    failNext("PlanningGraph", "View is still offline");
    fireEvent.click(sprint.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(sprint.getByRole("alert")).toHaveTextContent("View is still offline"));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await sprint.findByText("Already saved")).toBeVisible();
    await waitFor(() => expect(input).toHaveValue(""));
    expect(sprint.queryByRole("alert")).not.toBeInTheDocument();
    expect(requests.filter((request) => request.operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
    expect(requests.filter((request) => request.operation === "PlanWorkItem")).toHaveLength(1);
  });

  it("[overhaul-541] recovers a committed lost create response through read-only inspection and never repeats create blindly", async () => {
    const { requests, failNext, loseNext } = mountPlanning();
    const backlog = await openEpic();
    const sprint = within(screen.getByTestId("plan-sprint-items"));
    loseNext("CreateWorkTrackerWorkItem");
    failNext("PlanningGraph", "Inspection is offline");
    fireEvent.click(sprint.getByRole("button", { name: "Add story" }));
    const input = sprint.getByRole("textbox", { name: "Story title" });
    fireEvent.change(input, { target: { value: "Maybe saved" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const alert = await sprint.findByRole("alert");
    expect(alert).toHaveTextContent("Could not confirm whether the story was created");
    await waitFor(() => expect(alert).toHaveTextContent("Inspection is offline"));
    expect(input).toHaveValue("Maybe saved");
    expect(input).toHaveAttribute("readonly");
    expect(backlog.queryByText("Maybe saved")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    failNext("PlanningGraph", "Inspection still unavailable");
    fireEvent.click(sprint.getByRole("button", { name: "Inspect backlog" }));
    await waitFor(() => expect(sprint.getByRole("alert")).toHaveTextContent("Inspection still unavailable"));
    fireEvent.click(sprint.getByRole("button", { name: "Inspect backlog" }));
    expect(await backlog.findByText("Maybe saved")).toBeVisible();
    expect(sprint.getByRole("alert")).toHaveTextContent("Could not confirm whether the story was created");
    expect(sprint.getByRole("alert")).not.toHaveTextContent("Inspection still unavailable");
    expect(input).toHaveValue("Maybe saved");
    expect(input).toHaveAttribute("readonly");
    expect(requests.filter((request) => request.operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
    expect(requests.filter((request) => request.operation === "PlanWorkItem")).toEqual([]);
    fireEvent.click(sprint.getByRole("button", { name: "Dismiss" }));
    expect(sprint.queryByRole("alert")).not.toBeInTheDocument();
    expect(backlog.getByText("Maybe saved")).toBeVisible();
  });

  it("[overhaul-542] ignores empty and repeated pending submissions, restores entry focus, and cancels only the inline draft with Escape", async () => {
    const { requests, holdNext } = mountPlanning();
    const backlog = await openEpic();
    fireEvent.click(backlog.getByRole("button", { name: "Add story" }));
    const input = backlog.getByRole("textbox", { name: "Story title" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(requests.filter((request) => request.operation === "CreateWorkTrackerWorkItem")).toEqual([]);
    const release = holdNext("CreateWorkTrackerWorkItem");
    try {
      fireEvent.change(input, { target: { value: "One story only" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(input).toBeDisabled());
      input.blur();
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(input).toHaveValue("One story only");
      expect(requests.filter((request) => request.operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
    } finally { await act(async () => { release(); }); }
    expect(await backlog.findByText("One story only")).toBeVisible();
    await waitFor(() => expect(input).toHaveValue(""));
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: "Cancelled draft" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(backlog.queryByRole("textbox", { name: "Story title" })).not.toBeInTheDocument();
    await waitFor(() => expect(backlog.getByRole("button", { name: "Add story" })).toHaveFocus());
    expect(screen.getByTestId("plan-sprint")).toBeVisible();
    fireEvent.click(backlog.getByRole("button", { name: "Add story" }));
    expect(backlog.getByRole("textbox", { name: "Story title" })).toHaveValue("");
    expect(requests.filter((request) => request.operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
    const nextInput = backlog.getByRole("textbox", { name: "Story title" });
    const releaseNext = holdNext("CreateWorkTrackerWorkItem");
    const otherControl = screen.getByRole("button", { name: "Add epic" });
    try {
      fireEvent.change(nextInput, { target: { value: "Second captured story" } });
      fireEvent.keyDown(nextInput, { key: "Enter" });
      await waitFor(() => expect(nextInput).toBeDisabled());
      otherControl.focus();
    } finally { await act(async () => { releaseNext(); }); }
    expect(await backlog.findByText("Second captured story")).toBeVisible();
    await waitFor(() => expect(nextInput).toHaveValue(""));
    expect(otherControl).toHaveFocus();
    expect(requests.filter((request) => request.operation === "CreateWorkTrackerWorkItem")).toHaveLength(2);
  });

  it("[overhaul-543] offers no inline creation without an active epic and disables creation in a completed sprint", async () => {
    const { requests } = mountPlanning({ status: "completed" });
    const backlog = within(await screen.findByTestId("plan-backlog"));
    const sprint = within(screen.getByTestId("plan-sprint-items"));
    expect(backlog.queryByRole("button", { name: "Add story" })).not.toBeInTheDocument();
    expect(sprint.queryByRole("button", { name: "Add story" })).not.toBeInTheDocument();
    await openEpic();
    expect(backlog.getByRole("button", { name: "Add story" })).toBeDisabled();
    expect(sprint.getByRole("button", { name: "Add story" })).toBeDisabled();
    fireEvent.click(backlog.getByRole("button", { name: "Add story" }));
    fireEvent.click(sprint.getByRole("button", { name: "Add story" }));
    expect(backlog.queryByRole("textbox", { name: "Story title" })).not.toBeInTheDocument();
    expect(sprint.queryByRole("textbox", { name: "Story title" })).not.toBeInTheDocument();
    expect(requests.filter((request) => request.operation === "CreateWorkTrackerWorkItem")).toEqual([]);
  });

  it("[overhaul-544] keeps a fresh Plan visit's draft when a previous visit's pending creation finishes", async () => {
    const { requests, holdNext } = mountPlanning();
    const backlog = await openEpic();
    fireEvent.click(backlog.getByRole("button", { name: "Add story" }));
    const input = backlog.getByRole("textbox", { name: "Story title" });
    const release = holdNext("CreateWorkTrackerWorkItem");
    try {
      fireEvent.change(input, { target: { value: "Saved from previous visit" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(input).toBeDisabled());
      fireEvent.click(screen.getByRole("button", { name: "Back to sprints" }));
      expect(screen.queryByTestId("plan-sprint")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Plan sprint" }));
      const currentBacklog = within(await screen.findByTestId("plan-backlog"));
      expect(currentBacklog.queryByRole("textbox", { name: "Story title" })).not.toBeInTheDocument();
      fireEvent.click(currentBacklog.getByRole("button", { name: "Add story" }));
      fireEvent.change(currentBacklog.getByRole("textbox", { name: "Story title" }), { target: { value: "Fresh visit draft" } });
    } finally { await act(async () => { release(); }); }
    const currentBacklog = within(screen.getByTestId("plan-backlog"));
    expect(await currentBacklog.findByText("Saved from previous visit")).toBeVisible();
    expect(currentBacklog.getByRole("textbox", { name: "Story title" })).toHaveValue("Fresh visit draft");
    expect(currentBacklog.queryByRole("alert")).not.toBeInTheDocument();
    expect(requests.filter((request) => request.operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
  });
});
