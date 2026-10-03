import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { WorkTrackerWorkItemDocument } from "../features/work-items/generated/workItems.documents";
import NewEpicChip from "../features/sprints/planning/NewEpicChip";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { PlanningGraph } from "../features/planning-graph";
import { EpicTabStrip } from "../features/sprints/planning/EpicTabStrip";
import { closePlanSprint, leavePlanWorkspace, openPlanSprint, openPlanWorkspace, setPlanVisit, usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import SprintsList from "../features/sprints/SprintsList";
import { sprint } from "../features/planning-graph/testGraph";
import { fixture, mountStudio, workItem } from "./seam";
import { workItem as planningWorkItem } from "../features/planning-graph/testGraph";

const graph: PlanningGraph = { project: { id: "project-1", name: "Project", slug: "PROJ" }, states: [], stateById: new Map(), storyType: { id: "story-type" }, epicType: { id: "epic-type" }, sprints: [], modules: [{ id: "a", name: "Alpha", key: "P-1" }, { id: "b", name: "Beta", key: "P-2" }], workItems: [] };
beforeEach(() => usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true));
it("[overhaul-461] lets a waiting suggestion without an epic be found again after closing its tab", () => {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  mountStudio({ http, children: <EpicTabStrip graph={graph} suggestions={[
    { sprintId: "s", status: "waiting", proposedEpicId: null, issue: { moduleId: null } },
  ]} sprintId="s" /> });
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "No epic, 0 backlog stories, 1 waiting suggestions" }));
  expect(screen.getByRole("tab", { name: "No epic, 0 backlog stories, 1 waiting suggestions" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("button", { name: "Close No epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "No epic, 0 backlog stories, 1 waiting suggestions" }));
  expect(screen.getByRole("tab", { name: "No epic, 0 backlog stories, 1 waiting suggestions" })).toHaveAttribute("aria-selected", "true");
});
it("[overhaul-464] keeps a removed epic's stories and suggestions reachable under No epic", () => {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  const planningGraph = { ...graph, states: [{ id: "idea", name: "Implement", group: "backlog", color: "" }],
    workItems: [planningWorkItem({ id: "story", moduleId: "b" })] };
  const suggestions = [{ sprintId: "s", status: "waiting", proposedEpicId: null, issue: { moduleId: "b" } }];
  const view = mountStudio({ http, children: <EpicTabStrip graph={planningGraph} suggestions={suggestions} sprintId="s" /> });
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Beta, 1 backlog stories, 1 waiting suggestions" }));
  expect(screen.getByRole("tab", { name: "Beta, 1 backlog stories, 1 waiting suggestions" })).toHaveAttribute("aria-selected", "true");
  view.rerender(<EpicTabStrip graph={{ ...planningGraph, modules: [graph.modules[0]] }} suggestions={suggestions} sprintId="s" />);
  expect(screen.getByRole("tab", { name: "No epic, 1 backlog stories, 1 waiting suggestions" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("tab", { name: /Beta/ })).not.toBeInTheDocument();
});
it("[overhaul-458] restores each sprint's chosen tabs and active epic after leaving Plan", () => {
  function PlanVisits() {
    const { active, sprintId } = usePlanWorkspace();
    return <>
      <button onClick={() => openPlanWorkspace("first")}>First sprint</button>
      <button onClick={() => openPlanWorkspace("second")}>Second sprint</button>
      <button onClick={leavePlanWorkspace}>Leave Plan</button>
      {active && sprintId && <EpicTabStrip graph={graph} suggestions={[]} sprintId={sprintId} />}
    </>;
  }
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  mountStudio({ http, children: <PlanVisits /> });
  fireEvent.click(screen.getByRole("button", { name: "First sprint" }));
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Alpha, 0 backlog stories" }));
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Beta, 0 backlog stories" }));
  fireEvent.click(screen.getByRole("button", { name: "Close Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "Second sprint" }));
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Alpha, 0 backlog stories" }));
  expect(screen.getByRole("tab", { name: "Alpha, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("button", { name: "Leave Plan" }));
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "First sprint" }));
  expect(screen.getByRole("tab", { name: "Beta, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("tab", { name: "Alpha, 0 backlog stories" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Leave Plan" }));
  fireEvent.click(screen.getByRole("button", { name: "Second sprint" }));
  expect(screen.getByRole("tab", { name: "Alpha, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("tab", { name: "Beta, 0 backlog stories" })).not.toBeInTheDocument();
});
it("[overhaul-434] adds, steps and closes epic tabs while preserving the sprint's visit", () => {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  mountStudio({ http, children: <EpicTabStrip graph={graph} suggestions={[]} sprintId="s" /> });
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Alpha, 0 backlog stories" }));
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Beta, 0 backlog stories" }));
  fireEvent.click(screen.getByRole("tab", { name: "Alpha, 0 backlog stories" }));
  fireEvent.click(screen.getByRole("button", { name: "Next epic" }));
  expect(screen.getByRole("tab", { name: "Beta, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("button", { name: "Close Beta" }));
  expect(screen.queryByRole("tab", { name: "Beta, 0 backlog stories" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Beta, 0 backlog stories" }));
  expect(screen.getByRole("tab", { name: "Beta, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
  expect(usePlanWorkspace.getState().visits.s).toEqual({ epicTabs: ["a", "b"], activeEpicId: "b" });
});

it("[overhaul-435] offers real new epic creation and reports missing project type before a write", () => {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  mountStudio({ http, children: <EpicTabStrip graph={{ ...graph, epicType: { error: "Configure an Epic type" } }} suggestions={[]} sprintId="s" /> });
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "+ New epic" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New epic name" }), { target: { value: "New epic" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "New epic name" }), { key: "Enter" });
  expect(screen.getByRole("alert")).toHaveTextContent("Configure an Epic type");
});

it("[overhaul-436] creates an epic once through the model write and opens its returned identity", async () => {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  const writes: unknown[] = [];
  let opened: string | null = null;
  mountStudio({ http, children: <NewEpicChip projectId="project-1" epicType={{ id: "epic-type" }} onCreated={(id) => { opened = id; }} />, graphQlExecute: async <TResult, TVariables>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
    if (documentOperationName(document) !== "CreateWorkTrackerWorkItem") return http.executeGraphQl(document, variables);
    writes.push(variables);
    http.workItems([workItem({ id: "new-epic", name: "Delivery", parent_id: null })]);
    const lookup = await http.executeGraphQl(WorkTrackerWorkItemDocument, { id: "new-epic" });
    return { create_work_item: lookup.work_item.nodes[0] } as TResult;
  } });
  fireEvent.click(screen.getByRole("button", { name: "+ New epic" }));
  const input = screen.getByRole("textbox", { name: "New epic name" });
  fireEvent.change(input, { target: { value: " Delivery " } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(opened).toBe("new-epic"));
  expect(writes).toEqual([{ projectId: "project-1", name: "Delivery", issueTypeId: "epic-type", parentId: null }]);
});

it("[overhaul-437] waits for suggestions before seeding and supports roving tab focus", () => {
  const http = fixture(); http.tree("module-1", { rootIds: [], children: {}, order: [] });
  const view = mountStudio({ http, children: <EpicTabStrip graph={graph} suggestions={[]} sprintId="s" ready={false} /> });
  expect(usePlanWorkspace.getState().visits.s).toBeUndefined();
  view.rerender(<EpicTabStrip graph={graph} suggestions={[]} sprintId="s" ready />);
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Alpha, 0 backlog stories" }));
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Beta, 0 backlog stories" }));
  const alpha = screen.getByRole("tab", { name: "Alpha, 0 backlog stories" });
  fireEvent.keyDown(alpha, { key: "ArrowRight" });
  const beta = screen.getByRole("tab", { name: "Beta, 0 backlog stories" });
  expect(beta).toHaveFocus(); expect(beta).toHaveAttribute("tabindex", "0"); expect(alpha).toHaveAttribute("tabindex", "-1");
  fireEvent.keyDown(beta, { key: "Home" }); expect(alpha).toHaveFocus();
});

it("[overhaul-438] keeps waiting suggestions visible in the add menu after closing their epic", () => {
  const http = fixture(); http.tree("module-1", { rootIds: [], children: {}, order: [] });
  mountStudio({ http, children: <EpicTabStrip graph={graph} suggestions={[{ sprintId: "s", status: "waiting", proposedEpicId: "b", issue: null }]} sprintId="s" /> });
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Beta, 0 backlog stories, 1 waiting suggestions" }));
  expect(screen.getByRole("tab", { name: "Beta, 0 backlog stories, 1 waiting suggestions" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("button", { name: "Close Beta" }));
  expect(usePlanWorkspace.getState().visits.s).toEqual({ epicTabs: [], activeEpicId: null });
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  expect(screen.getByRole("button", { name: "Beta, 0 backlog stories, 1 waiting suggestions" })).toBeVisible();
});

it("[overhaul-465] a new sprint opens with the last sprint's selected epics and active epic", async () => {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  const onCreateSprint = vi.fn(async () => "new-sprint");
  mountStudio({ http, children: <SprintsList graph={{ ...graph, sprints: [sprint({ id: "old-sprint" })] }}
    openStoryId={null} onOpenStory={vi.fn()} onOpenSprint={openPlanSprint}
    onCreateSprint={onCreateSprint} onUpdateSprint={vi.fn(async () => true)}
    renderSprintGoals={() => null} renderSuggestionAgentBox={() => null} /> });
  act(() => {
    openPlanSprint("old-sprint");
    setPlanVisit("old-sprint", { epicTabs: ["a", "b"], activeEpicId: "b" });
    closePlanSprint();
  });
  fireEvent.click(screen.getByRole("button", { name: "New sprint" }));
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(usePlanWorkspace.getState().sprintId).toBe("new-sprint"));
  expect(usePlanWorkspace.getState().visits["new-sprint"]).toEqual({ epicTabs: ["a", "b"], activeEpicId: "b" });
  expect(onCreateSprint).toHaveBeenCalledWith("Sprint 1");
});
