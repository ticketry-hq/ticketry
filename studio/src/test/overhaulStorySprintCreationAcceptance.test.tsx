import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { WorkTrackerWorkItemDocument, getWorkItemSnapshot } from "../features/work-items";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { useClientStore } from "../state/clientStore";
import { workItem } from "./seam";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

function capture() {
  const input = screen.getByRole("textbox", { name: "Capture an idea" });
  fireEvent.change(input, { target: { value: "New sprint story" } });
  fireEvent.keyDown(input, { key: "Enter" });
  return input;
}

function boundary(beforeCreate?: () => Promise<void>, unassigned = false,
  beforeFilterRead?: (operation: string) => Promise<void>) {
  const f = storySprintModuleBoundary();
  if (unassigned) {
    f.http.workItems([workItem({ id: "unassigned", name: "Unassigned root", sprint_id: null })]);
    f.http.tree("module-1", { rootIds: ["roadmap-24", "unassigned"], children: { "roadmap-24": [], unassigned: [] }, order: ["roadmap-24", "unassigned"] });
  }
  const creates: Array<{ name: string; sprintId: string | null }> = [];
  f.mount({ graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "CreateWorkTrackerWorkItem") {
      const input = variables as { name: string; sprintId: string | null; parentId: string };
      creates.push(input);
      await beforeCreate?.();
      f.http.workItems([workItem({ id: "captured", name: input.name, parent_id: input.parentId, sprint_id: input.sprintId })]);
      const rootIds = [...f.http.items.values()].filter((item) => item.parent_id === input.parentId).map((item) => item.id);
      f.http.tree(input.parentId, { rootIds, children: Object.fromEntries(rootIds.map((id) => [id, []])), order: rootIds });
      const row = await f.http.executeGraphQl(WorkTrackerWorkItemDocument, { id: "captured" });
      return { create_work_item: row.work_item.nodes[0] } as never;
    }
    await beforeFilterRead?.(documentOperationName(document));
    return f.execute(document, variables);
  } });
  return { ...f, creates };
}

it("[overhaul-586] keeps Active capture unassigned and offers Show all recovery without changing selection", async () => {
  const f = boundary();
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  const input = capture();
  await waitFor(() => {
    expect(getWorkItemSnapshot("captured")).toBeDefined();
  });
  await waitFor(() => expect(input).toHaveValue(""));
  expect(f.creates).toHaveLength(1);
  expect(f.creates[0]).toMatchObject({ sprintId: null });
  expect(getWorkItemSnapshot("captured")?.sprint_id).toBeNull();
  expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-1", selectedTaskId: "roadmap-24" });
  expect(screen.queryByText("Select a module to view its stories.")).toBeNull();
  expect(screen.queryByRole("treeitem", { name: /New sprint story/ })).toBeNull();
  expect(screen.getByRole("status", { name: "Idea captured outside results" })).toBeVisible();
  fireEvent.click(within(screen.getByRole("status", { name: "Idea captured outside results" })).getByRole("button", { name: "Show all sprints" }));
  await screen.findByRole("treeitem", { name: /New sprint story/ });
  expect(screen.getByRole("button", { name: "Sprint: All sprints" })).toBeVisible();
  expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-1", selectedTaskId: "roadmap-24" });
});

it("[overhaul-587] keeps capture unassigned under an explicitly selected planned sprint", async () => {
  const f = boundary();
  fireEvent.click(await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" }));
  fireEvent.click(await screen.findByRole("option", { name: /Sprint 25 planned/i }));
  await screen.findByRole("button", { name: "Sprint: Sprint 25, Planned" });
  await screen.findByRole("treeitem", { name: /Release next story/ });
  capture();
  await waitFor(() => {
    expect(getWorkItemSnapshot("captured")).toBeDefined();
  });
  expect(f.creates[0]).toMatchObject({ sprintId: null });
  expect(getWorkItemSnapshot("captured")?.sprint_id).toBeNull();
  expect(screen.queryByRole("treeitem", { name: /New sprint story/ })).toBeNull();
  expect(screen.getByRole("status", { name: "Idea captured outside results" })).toBeVisible();
  expect(useClientStore.getState().selectedModuleId).toBe("module-3");
});

it("[overhaul-588] keeps All capture unassigned", async () => {
  const f = boundary();
  fireEvent.click(await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" }));
  fireEvent.click(screen.getByRole("option", { name: /All sprints/ }));
  capture();
  await waitFor(() => {
    expect(getWorkItemSnapshot("captured")).toBeDefined();
    expect(screen.getByRole("treeitem", { name: /New sprint story/ })).toBeVisible();
  });
  expect(f.creates[0]).toMatchObject({ sprintId: null });
  expect(getWorkItemSnapshot("captured")?.sprint_id).toBeNull();
});

it("[overhaul-589] retains the draft after rejected idea capture and submits only once while pending", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const f = boundary(async () => { await gate; throw new FoundationGraphQlError("validation", "Story creation rejected"); });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  const input = capture();
  await waitFor(() => expect(f.creates).toHaveLength(1));
  fireEvent.keyDown(input, { key: "Enter" });
  await act(async () => release());
  await waitFor(() => expect(input).toHaveAttribute("aria-busy", "false"));
  expect(input).toHaveValue("New sprint story");
  expect(f.creates).toHaveLength(1);
  expect(getWorkItemSnapshot("captured")).toBeUndefined();
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
});

it("[overhaul-590] keeps No sprint capture unassigned", async () => {
  const f = boundary(undefined, true);
  fireEvent.click(await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" }));
  fireEvent.click(screen.getByRole("option", { name: /No sprint/ }));
  await screen.findByRole("treeitem", { name: /Unassigned root/ });
  const input = capture();
  await waitFor(() => expect(input).toHaveValue(""));
  expect(f.creates[0]).toMatchObject({ sprintId: null });
  expect(getWorkItemSnapshot("captured")?.sprint_id).toBeNull();
});

it("[overhaul-591] keeps capture unassigned when the filter changes before creation returns", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const f = boundary(() => gate);
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  const input = capture();
  await waitFor(() => expect(f.creates).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" }));
  fireEvent.click(screen.getByRole("option", { name: /All sprints/ }));
  await act(async () => release());
  await waitFor(() => expect(input).toHaveValue(""));
  expect(f.creates[0]).toMatchObject({ sprintId: null });
  expect(getWorkItemSnapshot("captured")?.sprint_id).toBeNull();
  expect(screen.getByRole("treeitem", { name: /New sprint story/ })).toBeVisible();
  expect(screen.queryByRole("status", { name: "Idea captured outside results" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sprint: All sprints" })).toBeVisible();
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
});

it("[overhaul-594] captures an unassigned idea while the Active sprint read is pending", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const f = boundary(undefined, false, async (operation) => {
    if (operation === "StoryActiveSprint") await gate;
  });
  await screen.findByText("Loading sprint stories…");
  const input = capture();
  try {
    await waitFor(() => expect(input).toHaveValue(""));
    expect(f.creates).toHaveLength(1);
    expect(f.creates[0]).toMatchObject({ sprintId: null });
    expect(getWorkItemSnapshot("captured")?.sprint_id).toBeNull();
    expect(input).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("Loading sprint stories…")).toBeVisible();
    expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-1", selectedTaskId: "roadmap-24" });
  } finally {
    await act(async () => release());
  }
});

it("[overhaul-595] captures an unassigned idea after sprint membership reads fail", async () => {
  const f = boundary(undefined, false, async (operation) => {
    if (operation === "ProjectStorySprintIndex") throw new FoundationGraphQlError("unknown", "Membership read failed");
  });
  await screen.findByRole("button", { name: "Retry" });
  const input = capture();
  await waitFor(() => expect(input).toHaveValue(""));
  expect(f.creates).toHaveLength(1);
  expect(f.creates[0]).toMatchObject({ sprintId: null });
  expect(getWorkItemSnapshot("captured")?.sprint_id).toBeNull();
  expect(input).toHaveAttribute("aria-busy", "false");
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(screen.getByRole("status", { name: "Idea captured outside results" })).toBeVisible();
  expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-1", selectedTaskId: "roadmap-24" });
});
