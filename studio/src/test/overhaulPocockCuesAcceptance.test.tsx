import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { editionAcceptanceFixture } from "./editionAcceptanceFixture";
import { WorkTrackerWorkItemDocument } from "../features/work-items";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { useTerminalStore } from "../features/agents/terminal";
import { loadXtermTerminal } from "../features/agents/terminal/xtermTerminalLoader";
import { workItem } from "./seam";
import { getStorySprintFilterIntent, setStorySprintFilterIntent } from "../features/work-items/internal/storySprintFilterStore";

it("[overhaul-577] Pocock ordinary Stories and module picker omit sprint selectors, counts and recovery actions", async () => {
  const f = editionAcceptanceFixture();
  f.mount();
  const stories = await screen.findByTestId("tasks-pane-body");
  expect(await within(stories).findByRole("treeitem", { name: /Roadmap current story/ })).toBeVisible();
  expect(within(stories).queryByRole("button", { name: /^Sprint:/ })).not.toBeInTheDocument();
  expect(within(stories).queryByText(/of \d+ stories/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Loading sprint stories|Sprint results unavailable|Sprint filter unavailable/)).not.toBeInTheDocument();
  expect(screen.queryByText("This story is outside the current results. It stays open here.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open module picker" }));
  const picker = within(screen.getByRole("dialog", { name: "Module picker" }));
  expect(picker.queryByRole("option", { name: "Show all sprints" })).not.toBeInTheDocument();
  expect(picker.getByRole("option", { name: "Restore bugs module tab" })).toBeVisible();
});

it("[overhaul-579] Pocock capture ignores remembered sprint intent and retains generic text exclusion feedback without sprint recovery", async () => {
  const f = editionAcceptanceFixture();
  let captures = 0;
  f.mount({ graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "CreateWorkTrackerWorkItem") {
      const id = `captured-${++captures}`;
      const input = variables as { name: string };
      f.http.workItems([workItem({ id, name: input.name, parent_id: "module-1", sprint_id: null })]);
      const roots = ["roadmap-24", ...Array.from({ length: captures }, (_, index) => `captured-${index + 1}`)];
      f.http.tree("module-1", { rootIds: roots, children: Object.fromEntries(roots.map((root) => [root, []])), order: roots });
      const row = await f.http.executeGraphQl(WorkTrackerWorkItemDocument, { id });
      return { create_work_item: row.work_item.nodes[0] } as never;
    }
    return f.execute(document, variables);
  } });
  await screen.findByRole("treeitem", { name: /Roadmap current story/ });
  act(() => setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-25" }));
  const capture = screen.getByRole("textbox", { name: "Capture an idea" });
  fireEvent.change(capture, { target: { value: "Unassigned ordinary idea" } });
  fireEvent.keyDown(capture, { key: "Enter" });
  await waitFor(() => expect(capture).toHaveValue(""));
  expect(await screen.findByRole("treeitem", { name: /Unassigned ordinary idea/ })).toBeVisible();
  expect(screen.queryByRole("status", { name: "Idea captured outside results" })).not.toBeInTheDocument();
  const search = screen.getByRole("textbox", { name: "Search stories" });
  fireEvent.change(search, { target: { value: "Roadmap" } });
  fireEvent.change(capture, { target: { value: "Fresh unassigned idea" } });
  fireEvent.keyDown(capture, { key: "Enter" });
  const notice = await screen.findByRole("status", { name: "Idea captured outside results" });
  expect(notice).toHaveTextContent("Idea captured outside the current results.");
  expect(within(notice).queryByRole("button", { name: "Show all sprints" })).not.toBeInTheDocument();
  expect(search).toHaveValue("Roadmap");
  expect(useClientStore.getState().selectedTaskId).toBe("roadmap-24");
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "id", sprintId: "sprint-25" });
  expect(f.http.items.get("captured-1")?.sprint_id).toBeNull();
  expect(f.http.items.get("captured-2")?.sprint_id).toBeNull();
});

it("[overhaul-578] Pocock text search retains its empty feedback, clear action and excluded selected Story Details", async () => {
  const f = editionAcceptanceFixture();
  f.mount();
  const stories = await screen.findByTestId("tasks-pane-body");
  await within(stories).findByRole("treeitem", { name: /Roadmap current story/ });
  const search = within(stories).getByRole("textbox", { name: "Search stories" });
  fireEvent.change(search, { target: { value: "ordinary missing text" } });
  expect(await within(stories).findByText('No stories match "ordinary missing text".')).toBeVisible();
  expect(await screen.findByText("This story is outside the current results. It stays open here.")).toBeVisible();
  expect(screen.getByRole("region", { name: "Details" })).toHaveTextContent("Roadmap current story");
  expect(within(stories).queryByRole("button", { name: "Show all sprints" })).not.toBeInTheDocument();
  expect(screen.queryByText("No stories in this sprint.")).not.toBeInTheDocument();
  fireEvent.click(within(stories).getByRole("button", { name: "Clear story search" }));
  expect(search).toHaveValue("");
  expect(await within(stories).findByRole("treeitem", { name: /Roadmap current story/ })).toBeVisible();
  expect(screen.queryByText("This story is outside the current results. It stays open here.")).not.toBeInTheDocument();
  expect(useClientStore.getState().selectedTaskId).toBe("roadmap-24");
});

it("[overhaul-580] Pocock search and normal workspace navigation preserve documents, Conversations, durable runs and planning records", async () => {
  const f = editionAcceptanceFixture({ withDocument: true });
  f.mount();
  await screen.findByRole("treeitem", { name: /Roadmap current story/ });
  const records = JSON.stringify([f.graph, f.goals, f.suggestions, f.presentations]);
  const design = await screen.findByRole("tab", { name: "DESIGN" });
  fireEvent.click(design);
  expect(design).toHaveAttribute("aria-selected", "true");
  act(f.seedTerminal);
  fireEvent.click(screen.getByRole("tab", { name: "Details" }));
  // The retained terminal starts a real renderer import. Keep this test's
  // jsdom environment alive until it settles after returning to Details.
  await act(async () => { await loadXtermTerminal(); });
  expect(screen.getByRole("region", { name: "Details" })).toHaveTextContent("Roadmap current story");
  const search = screen.getByRole("textbox", { name: "Search stories" });
  fireEvent.change(search, { target: { value: "ordinary missing text" } });
  expect(await screen.findByText('No stories match "ordinary missing text".')).toBeVisible();
  expect(design).toBeVisible();
  expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("button", { name: "Collapse Conversations" }));
  expect(screen.getByRole("button", { name: "Expand Conversations" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Expand Conversations" }));
  expect(screen.getByRole("button", { name: "Collapse Conversations" })).toBeVisible();
  expect(useTerminalStore.getState().sessionByRun["run-retained"]).toBe("viewer-retained");
  expect(useTerminalStore.getState().sessions["viewer-retained"]).toMatchObject({ taskId: "roadmap-24", agentRunId: "run-retained" });
  expect(useClientStore.getState().workspaces["roadmap-24"].closedDocIds).not.toContain("design");
  expect(JSON.stringify([f.graph, f.goals, f.suggestions, f.presentations])).toBe(records);
  expect(f.calls.filter(({ operation }) => /^(Create|Update|Delete)(Sprint|Planning)|UpdateWorkTrackerModulePresentation|UpdateTerminalSession/.test(operation))).toEqual([]);
});
