import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { WorkTrackerWorkItemDocument, getWorkItemSnapshot } from "../features/work-items";
import { useClientStore } from "../state/clientStore";
import { workItem } from "./seam";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-510] captures an unassigned Story outside results and offers All without changing Story search or selection", async () => {
  const f = storySprintModuleBoundary();
  let createInput: unknown;
  f.mount({ graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "CreateWorkTrackerWorkItem") {
      createInput = variables;
      const input = variables as { name: string; sprintId: string | null };
      f.http.workItems([workItem({ id: "captured", name: input.name, parent_id: "module-1", sprint_id: input.sprintId })]);
      f.http.tree("module-1", { rootIds: ["roadmap-24", "captured"], children: { "roadmap-24": [], captured: [] }, order: ["roadmap-24", "captured"] });
      const row = await f.http.executeGraphQl(WorkTrackerWorkItemDocument, { id: "captured" });
      return { create_work_item: row.work_item.nodes[0] } as never;
    }
    return f.execute(document, variables);
  } });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.change(screen.getByRole("textbox", { name: "Search stories" }), { target: { value: "Roadmap" } });
  const capture = screen.getByRole("textbox", { name: "Capture an idea" });
  fireEvent.change(capture, { target: { value: "Fresh sprint idea" } });
  fireEvent.keyDown(capture, { key: "Enter" });
  const notice = await screen.findByRole("status", { name: "Idea captured outside results" });
  expect(notice).toHaveTextContent("Idea captured outside the current results.");
  expect(getWorkItemSnapshot("captured")?.sprint_id).toBeNull();
  expect(createInput).toMatchObject({ sprintId: null });
  expect(useClientStore.getState().selectedTaskId).toBe("roadmap-24");
  fireEvent.click(within(notice).getByRole("button", { name: "Show all sprints" }));
  await screen.findByRole("button", { name: "Sprint: All sprints" });
  expect(screen.getByRole("textbox", { name: "Search stories" })).toHaveValue("Roadmap");
  expect(useClientStore.getState().selectedTaskId).toBe("roadmap-24");
  await waitFor(() => expect(capture).toHaveValue(""));
  fireEvent.click(screen.getByRole("button", { name: "Sprint: All sprints" }));
  expect(await screen.findByRole("option", { name: "All sprints 5" })).toBeVisible();
  fireEvent.click(screen.getByRole("option", { name: "No sprint 1" }));
  await screen.findByRole("button", { name: "Sprint: No sprint" });
  await waitFor(() => expect(screen.queryAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id"))).toHaveLength(1));
  expect(screen.getByRole("tab", { name: "Roadmap" })).toBeVisible();
  expect(screen.queryByRole("treeitem", { name: /Fresh sprint idea/ })).toBeNull();
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  expect(useClientStore.getState().selectedTaskId).toBe("roadmap-24");
  expect(useClientStore.getState().storySearchQuery).toBe("Roadmap");
});
