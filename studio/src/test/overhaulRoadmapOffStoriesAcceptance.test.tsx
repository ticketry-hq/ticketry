import { act, fireEvent, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { roadmapAvailabilityFixture } from "./roadmapAvailabilityFixture";
import { workItem } from "./seam";
import { setStorySprintFilterIntent, getStorySprintFilterIntent } from "../features/work-items/internal/storySprintFilterStore";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useTerminalStore } from "../features/agents/terminal";
import { AGENT_RUN_ACTIONS, studioKeymapRegistry } from "../app/navigation/keymapRegistry";
import { getStorySprintFilterGeneration } from "../features/work-items/internal/storySprintFilterStore";
import { dragWorkItem } from "./workItemDragGestures";

const FILTER_READS = ["StoryActiveSprint", "StorySelectedSprint", "SprintChoicePage", "ProjectStorySprintModules", "ProjectStorySprintIndex"];

it("[overhaul-569] OFF shows every ordinary Story branch despite active and remembered explicit sprint restrictions", async () => {
  const f = roadmapAvailabilityFixture();
  f.http.workItems([
    workItem({ id: "outside-root", name: "Outside sprint root", sprint_id: "sprint-25", rank: "b", sub_issues_count: 1 }),
    workItem({ id: "outside-child", name: "Outside sprint child", parent_id: "outside-root", sprint_id: null }),
    workItem({ id: "unassigned-root", name: "Unassigned root", sprint_id: null, rank: "c" }),
  ]);
  f.http.tree("module-1", { rootIds: ["roadmap-24", "outside-root", "unassigned-root"],
    children: { "roadmap-24": [], "outside-root": ["outside-child"], "outside-child": [], "unassigned-root": [] },
    order: ["roadmap-24", "outside-root", "outside-child", "unassigned-root"] });
  f.mount({ selectedTaskId: "outside-root" });
  act(() => setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-24" }));
  const stories = within(await screen.findByTestId("tasks-pane-body"));
  expect(await stories.findByRole("treeitem", { name: /Roadmap current story/ })).toBeVisible();
  expect(await stories.findByRole("treeitem", { name: /Outside sprint root/ })).toBeVisible();
  expect(await stories.findByRole("treeitem", { name: /Unassigned root/ })).toBeVisible();
  expect(screen.getByTestId("details-or-terminal-pane-body")).toHaveTextContent("Outside sprint root");
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "id", sprintId: "sprint-24" });
  expect(f.http.items.get("outside-root")?.sprint_id).toBe("sprint-25");
  expect(f.http.items.get("outside-child")?.sprint_id).toBeNull();
});

it("[overhaul-571] OFF keeps ordinary search expansion, workflow collapse and Story reorder rules", async () => {
  const f = roadmapAvailabilityFixture();
  f.http.workItems([
    workItem({ id: "outside-root", name: "Outside root", sprint_id: "sprint-25", rank: "b", sub_issues_count: 1 }),
    workItem({ id: "outside-child", name: "Matching child", parent_id: "outside-root", sprint_id: null }),
    workItem({ id: "unassigned-root", name: "Unassigned root", sprint_id: null, rank: "c" }),
  ]);
  f.http.tree("module-1", { rootIds: ["roadmap-24", "outside-root", "unassigned-root"],
    children: { "roadmap-24": [], "outside-root": ["outside-child"], "outside-child": [], "unassigned-root": [] },
    order: ["roadmap-24", "outside-root", "outside-child", "unassigned-root"] });
  f.mount();
  act(() => setStorySprintFilterIntent("project-1", { mode: "none" }));
  const stories = within(await screen.findByTestId("tasks-pane-body"));
  const outside = await stories.findByRole("treeitem", { name: /Outside root/ });
  expect(outside).toHaveAttribute("draggable", "true");
  fireEvent.change(stories.getByRole("textbox", { name: "Search stories" }), { target: { value: "Matching child" } });
  expect(await stories.findByRole("treeitem", { name: /Matching child/ })).toBeVisible();
  expect(stories.getByRole("treeitem", { name: /Outside root/ })).toBeVisible();
  expect(stories.queryByRole("treeitem", { name: /Roadmap current story/ })).toBeNull();
  expect(outside).not.toHaveAttribute("draggable", "true");
  fireEvent.click(stories.getByRole("button", { name: "Clear search" }));
  expect(stories.queryByRole("treeitem", { name: /Matching child/ })).toBeNull();
  expect(outside).toHaveAttribute("draggable", "true");
  fireEvent.click(stories.getByRole("button", { name: "Collapse Ideas" }));
  expect(stories.queryByRole("treeitem", { name: /Unassigned root/ })).toBeNull();
  fireEvent.click(stories.getByRole("button", { name: "Expand Ideas" }));
  const unassigned = stories.getByRole("treeitem", { name: /Unassigned root/ });
  const current = stories.getByRole("treeitem", { name: /Roadmap current story/ });
  const reordered = f.http.expectReorder("unassigned-root", { before_id: null, after_id: "roadmap-24" });
  dragWorkItem(unassigned, current, "before");
  await reordered;
  expect(f.http.items.get("outside-root")?.sprint_id).toBe("sprint-25");
  expect(f.http.items.get("unassigned-root")?.sprint_id).toBeNull();
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "none" });
});

it("[overhaul-572] OFF explicit run reveal preserves remembered sprint intent and durable run identity", async () => {
  const f = roadmapAvailabilityFixture();
  f.mount();
  await screen.findByRole("treeitem", { name: /Roadmap current story/ });
  act(() => {
    f.seedTerminal();
    const run = useAgentStatusStore.getState().runs["run-retained"];
    useAgentStatusStore.setState({ runs: { "run-retained": { ...run, module_id: "module-3", task_id: "release-25" } } });
    setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-24" });
  });
  const generation = getStorySprintFilterGeneration("project-1");
  await act(async () => {
    expect(await studioKeymapRegistry.dispatch(AGENT_RUN_ACTIONS.focusAgentRun, { runId: "run-retained" })).toBe(true);
  });
  expect(await screen.findByRole("treeitem", { name: /Release next story/ })).toHaveAttribute("aria-selected", "true");
  expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-3", selectedTaskId: "release-25" });
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "id", sprintId: "sprint-24" });
  expect(getStorySprintFilterGeneration("project-1")).toBe(generation);
  expect(useAgentStatusStore.getState().runs["run-retained"]).toMatchObject({ state: "working", task_id: "release-25" });
  expect(useTerminalStore.getState().sessionByRun["run-retained"]).toBe("viewer-retained");
});

it("[overhaul-570] cold and failed sprint reads never delay OFF Stories or start hidden membership indexing", async () => {
  const f = roadmapAvailabilityFixture();
  const planningReads: string[] = [];
  f.mount({ graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    if (FILTER_READS.includes(operation)) {
      planningReads.push(operation);
      throw new Error("Planning data unavailable");
    }
    return f.execute(document, variables);
  } });
  act(() => setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-25" }));
  expect(await screen.findByRole("treeitem", { name: /Roadmap current story/ })).toBeVisible();
  fireEvent.focus(window);
  fireEvent.click(screen.getByRole("tab", { name: "0.2.0" }));
  expect(await screen.findByRole("treeitem", { name: /Release next story/ })).toBeVisible();
  expect(planningReads).toEqual([]);
  expect(screen.queryByText("Loading sprint stories…")).toBeNull();
  expect(screen.queryByText("Sprint results unavailable")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});
