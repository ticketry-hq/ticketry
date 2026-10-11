import { act, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createWorkItemInvalidator } from "../features/agents/status/stream/workItemInvalidation";
import type { WorkItemFact } from "../features/agents/status/stream/statusFacts";
import { reparentWorkItem, deleteWorkItem } from "../features/work-items/mutationTransport";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { recordLocalWorkItemConvergence } from "../features/work-items/workItemConvergence";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";
import { workItem } from "./seam";

const invalidator = createWorkItemInvalidator();
afterEach(() => invalidator.cancel());
function tabs() { return screen.queryAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id")).map((tab) => tab.getAttribute("aria-label")); }
function publish(workItemId: string, overrides: Partial<WorkItemFact> = {}) {
  act(() => { invalidator.record({ family: "work_item", workItemId, projectId: "project-1", moduleId: "module-3", itemKind: "task", removed: false, membershipChanged: true, occurredAt: null, ...overrides }); invalidator.flush(); });
}

it("[overhaul-503] refreshes unopened module root membership independently of a locally consumed canonical fact", async () => {
  const boundary = storySprintModuleBoundary();
  // Structural membership cases use an explicitly open module.
  boundary.presentations[1] = { ...boundary.presentations[1]!, tab_hidden: false }; boundary.mount();
  await waitFor(() => expect(tabs()).toEqual(["Roadmap", "bugs"]));
  boundary.http.workItems([workItem({ id: "new-release-root", name: "New release root", parent_id: "module-3", sprint_id: "sprint-24", updated_at: "2026-10-08T11:00:00Z" })]);
  boundary.http.tree("module-3", { rootIds: ["release-25", "new-release-root"], children: { "release-25": [], "new-release-root": [] }, order: ["release-25", "new-release-root"] });
  recordLocalWorkItemConvergence("new-release-root", "2026-10-08T11:00:00Z");
  publish("new-release-root", { occurredAt: "2026-10-08T11:00:00Z" });
  await waitFor(() => expect(tabs()).toEqual(["Roadmap", "bugs", "0.2.0"]));
  expect(boundary.calls.filter((call) => call.operation === "WorkTrackerWorkItem" && (call.variables as any).id === "new-release-root")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" }));
  expect(await screen.findByRole("option", { name: "Sprint 24 Active 3" })).toBeVisible();
});


it("[overhaul-504] converges external archive, unarchive, delete and root/child transitions across unopened modules", async () => {
  const boundary = storySprintModuleBoundary();
  // Structural membership cases use an explicitly open module.
  boundary.presentations[1] = { ...boundary.presentations[1]!, tab_hidden: false }; boundary.mount();
  await waitFor(() => expect(tabs()).toEqual(["Roadmap", "bugs"]));
  boundary.http.revise("bugs-24", { is_archived: true });
  publish("bugs-24", { moduleId: "module-2" });
  await waitFor(() => expect(tabs()).toEqual(["Roadmap"]));
  boundary.http.revise("bugs-24", { is_archived: false });
  publish("bugs-24", { moduleId: "module-2" });
  await waitFor(() => expect(tabs()).toEqual(["Roadmap", "bugs"]));
  boundary.http.revise("bugs-24", { parent_id: "bugs-25" });
  boundary.http.tree("module-2", { rootIds: ["bugs-25"], children: { "bugs-25": ["bugs-24"], "bugs-24": [] }, order: ["bugs-25", "bugs-24"] });
  publish("bugs-24", { moduleId: "module-2" });
  await waitFor(() => expect(tabs()).toEqual(["Roadmap"]));
  boundary.http.revise("bugs-24", { parent_id: "module-2" });
  boundary.http.tree("module-2", { rootIds: ["bugs-24", "bugs-25"], children: { "bugs-24": [], "bugs-25": [] }, order: ["bugs-24", "bugs-25"] });
  publish("bugs-24", { moduleId: "module-2" });
  await waitFor(() => expect(tabs()).toEqual(["Roadmap", "bugs"]));
  if (!(boundary.http.items instanceof Map)) throw new Error("Fixture rows must be mutable.");
  boundary.http.items.delete("bugs-24");
  publish("bugs-24", { moduleId: "module-2", removed: true });
  await waitFor(() => expect(tabs()).toEqual(["Roadmap"]));
});


it("[overhaul-505] adds newly eligible roots after local reparent before its durable fact arrives", async () => {
  const boundary = storySprintModuleBoundary();
  // Structural membership cases use an explicitly open module.
  boundary.presentations[1] = { ...boundary.presentations[1]!, tab_hidden: false };
  boundary.http.revise("bugs-24", { parent_id: "bugs-25" });
  boundary.http.tree("module-2", { rootIds: ["bugs-25"], children: { "bugs-25": ["bugs-24"], "bugs-24": [] }, order: ["bugs-25", "bugs-24"] });
  boundary.mount({ graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "DeleteWorkTrackerWorkItem") {
      if (!(boundary.http.items instanceof Map)) throw new Error("Fixture rows must be mutable.");
      boundary.http.items.delete("bugs-24");
      boundary.http.tree("module-2", { rootIds: ["bugs-25"], children: { "bugs-25": [] }, order: ["bugs-25"] });
      return { delete_work_item: true } as never;
    }
    if (documentOperationName(document) === "ReparentWorkTrackerWorkItem") {
      boundary.http.tree("module-2", { rootIds: ["bugs-24", "bugs-25"], children: { "bugs-24": [], "bugs-25": [] }, order: ["bugs-24", "bugs-25"] });
    }
    return boundary.execute(document, variables);
  } });
  await waitFor(() => expect(tabs()).toEqual(["Roadmap"]));
  await act(async () => { await reparentWorkItem("bugs-24", "module-2", { moduleId: "module-2" }); });
  await waitFor(() => expect(tabs()).toEqual(["Roadmap", "bugs"]));
  expect(boundary.calls.filter((call) => call.operation === "ReparentWorkTrackerWorkItem")).toHaveLength(1);
  await act(async () => { await deleteWorkItem("bugs-24", { moduleId: "module-2" }); });
  await waitFor(() => expect(tabs()).toEqual(["Roadmap"]));
});

it("[overhaul-506] refreshes roots on focus and chooser reopen, retaining complete tabs and Story input through errors and Retry", async () => {
  const boundary = storySprintModuleBoundary();
  // Structural membership cases use an explicitly open module.
  boundary.presentations[1] = { ...boundary.presentations[1]!, tab_hidden: false };
  let fail = false;
  boundary.mount({ graphQlExecute: async (document, variables) => {
    if (fail && documentOperationName(document) === "ProjectStorySprintIndex") throw new Error("Membership unavailable");
    return boundary.execute(document, variables);
  } });
  await waitFor(() => expect(tabs()).toEqual(["Roadmap", "bugs"]));
  const input = screen.getByRole("textbox", { name: "Search stories" });
  fireEvent.change(input, { target: { value: "Roadmap" } });
  boundary.http.revise("release-25", { sprint_id: "sprint-24" });
  fireEvent.focus(window);
  await waitFor(() => expect(tabs()).toEqual(["Roadmap", "bugs", "0.2.0"]));
  fail = true;
  fireEvent.focus(window);
  await screen.findByText("Sprint results unavailable");
  expect(tabs()).toEqual(["Roadmap", "bugs", "0.2.0"]);
  expect(input).toHaveValue("Roadmap");
  fail = false;
  boundary.http.revise("release-25", { sprint_id: "sprint-25" });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(tabs()).toEqual(["Roadmap", "bugs"]));
  boundary.http.revise("release-25", { sprint_id: "sprint-24" });
  fireEvent.click(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" }));
  await waitFor(() => expect(tabs()).toEqual(["Roadmap", "bugs", "0.2.0"]));
  expect(await screen.findByRole("option", { name: "Sprint 24 Active 3" })).toBeVisible();
  expect(input).toHaveValue("Roadmap");
});
