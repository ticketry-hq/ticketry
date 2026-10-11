import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { useClientStore } from "../state/clientStore";

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

it("[overhaul-491] keeps project sprint recovery reachable with zero matching tabs and restores All", async () => {
  const f = storySprintModuleBoundary();
  f.mount();
  fireEvent.click(await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" }));
  fireEvent.click(await screen.findByRole("option", { name: /Empty sprint/ }));
  expect(await screen.findByText("No modules have stories in this sprint.")).toBeVisible();
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBeNull());
  expect(screen.getByRole("button", { name: "Sprint: Empty sprint, Planned" })).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "Search stories" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Details" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Conversations/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Open module picker" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Show all sprints" }));
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe("module-1"));
  expect(await screen.findByRole("textbox", { name: "Search stories" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Sprint: All sprints" })).toBeVisible();
});

it("[overhaul-492] uses normal saved visibility for unknown membership then retains complete tabs on refresh failure", async () => {
  const f = storySprintModuleBoundary();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  let fail = false;
  f.mount({ graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "ProjectStorySprintIndex") {
      if (first) { first = false; await gate; }
      if (fail) throw new FoundationGraphQlError("unknown", "Temporary membership failure");
    }
    return f.execute(document, variables);
  } });
  await screen.findByRole("tab", { name: "Roadmap" });
  expect(screen.getByRole("tab", { name: "0.2.0" })).toBeVisible();
  expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull();
  expect(screen.queryByText("No modules have stories in this sprint.")).toBeNull();
  expect(screen.getByText("Loading sprint stories…")).toBeVisible();
  expect(screen.getByRole("tab", { name: "Roadmap" })).not.toHaveAttribute("draggable", "true");
  await act(async () => release());
  await waitFor(() => expect(screen.queryByRole("tab", { name: "0.2.0" })).toBeNull());
  expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull();
  fail = true;
  fireEvent.click(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" }));
  expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Roadmap" })).toBeVisible();
  expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull();
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  expect(screen.queryByText("No modules have stories in this sprint.")).toBeNull();
  fireEvent.keyDown(screen.getByRole("option", { name: /Sprint 24 Active/ }), { key: "Escape" });
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
});

it("[overhaul-493] refuses a truncated read without closing ordinary tabs and recovers through Retry", async () => {
  const f = storySprintModuleBoundary();
  let truncated = true;
  f.mount({ selectedModuleId: null, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    const data = await f.execute(document, variables);
    if (truncated && documentOperationName(document) === "ProjectStorySprintIndex") {
      const roots = (data as any).roots;
      return { ...data, roots: { ...roots, nodes: [], pageInfo: { ...roots.pageInfo, hasNextPage: true } } };
    }
    return data;
  } });
  expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Roadmap" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "0.2.0" })).toBeVisible();
  expect(screen.queryByText("No modules have stories in this sprint.")).toBeNull();
  expect(useClientStore.getState().selectedModuleId).toBeNull();
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" })).toBeVisible();
  expect(screen.getByText("Select a module to view its stories.")).toBeVisible();
  truncated = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("tab", { name: "0.2.0" })).toBeNull());
  expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe("module-1"));
  expect(await screen.findByRole("textbox", { name: "Search stories" })).toBeVisible();
});
