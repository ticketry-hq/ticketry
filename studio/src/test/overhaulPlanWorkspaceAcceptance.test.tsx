import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { SprintsWorkspace } from "../features/sprints/SprintsWorkspace";
import { WorkTrackerWorkItemDocument } from "../features/work-items/generated/workItems.documents";
import { loadModules } from "../features/projects";
import { PlanningGraphDocument } from "../features/planning-graph";
import { leavePlanWorkspace, openPlanWorkspace, usePlanWorkspace } from "../features/sprints";
import { closePlanSprint, openPlanItem, openPlanSprint } from "../features/sprints/planWorkspaceState";
import { studioApolloClient } from "../shared/apollo/client";
import { useClientStore } from "../state/clientStore";
import { getModuleTreeSnapshot, loadModuleTree } from "../features/work-items";
import { TEMP_TASK_ID, scratchBucketId } from "../features/agents/terminal";
import { fixture, mountStudio, workItem } from "./seam";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { EpicTabStrip } from "../features/sprints/planning/EpicTabStrip";
import type { PlanningGraph } from "../features/planning-graph";

const keyboardGraph: PlanningGraph = {
  project: { id: "project-1", name: "Planner", slug: "PLAN" }, states: [], stateById: new Map(),
  storyType: { id: "story" }, epicType: { id: "epic" }, sprints: [], workItems: [],
  modules: [{ id: "module-1", name: "Origin", key: "PLAN-1" }, { id: "module-2", name: "Other", key: "PLAN-2" }],
};
function KeyboardPlan() {
  useGlobalKeymap();
  const state = usePlanWorkspace();
  return <>
    <button onClick={() => openPlanWorkspace("sprint-1")}>Open keyboard Plan</button>
    <input aria-label="Plan typing" />
    {state.active && <>
      <EpicTabStrip graph={keyboardGraph} suggestions={[]} sprintId="sprint-1" />
      <button onClick={() => usePlanWorkspace.setState({ openItem: "suggestion:proposal-1" })}>Open proposal</button>
      {state.openItem && <output aria-label="Open Plan detail">Proposal</output>}
    </>}
  </>;
}

function PlanControls() {
  const state = usePlanWorkspace();
  return <div onKeyDown={(event) => { if (event.key === "Escape") leavePlanWorkspace(); }}>
    <button onClick={() => openPlanWorkspace()}>Plan</button>
    <button onClick={() => openPlanSprint("sprint-2")}>Second sprint</button>
    <button onClick={closePlanSprint}>Sprint list</button>
    <button onClick={() => openPlanItem("other-story")}>Other story</button>
    <output aria-label="Plan sprint">{state.sprintId ?? "list"}</output>
  </div>;
}
function cachePlanningGraph(moduleId: string | null = "module-2") {
  const data = {
    project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
    states: { __typename: "WorktrackerStateConnection", nodes: [] }, issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] },
    sprints: { __typename: "WorktrackerSprintConnection", nodes: [
      { __typename: "WorktrackerSprint", id: "completed", name: "Completed", status: "completed", createdAt: "2026-01-01" },
      { __typename: "WorktrackerSprint", id: "sprint-2", name: "Second", status: "planned", createdAt: "2026-03-01" },
      { __typename: "WorktrackerSprint", id: "sprint-1", name: "First", status: "planned", createdAt: "2026-02-01" },
    ] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: [
      { __typename: "WorktrackerIssue", id: "module-1", name: "Origin", sequenceId: 1, presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] } },
      { __typename: "WorktrackerIssue", id: "module-2", name: "Other", sequenceId: 2, presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] } },
    ] },
    workItems: { __typename: "WorktrackerIssueConnection", nodes: [{ __typename: "WorktrackerIssue", id: "other-story", name: "Other story", sequenceId: 3, rank: "V", parentId: "module-2",
      moduleId, stateId: null, stateRevision: 1, sprintId: "sprint-1",
      updatedAt: "2026-01-01", issueType: { __typename: "WorktrackerIssuetype", id: "story", name: "Story" },
    }] },
  };
  studioApolloClient().writeQuery({ query: PlanningGraphDocument, variables: { projectId: "project-1" }, data });
}
describe("overhaul acceptance, Plan workspace", () => {
  beforeEach(() => usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true));
  it("[overhaul-466] creates and focuses an epic from the tab menu and restores each sprint's planning visit", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    http.tree("module-2", { rootIds: [], children: {}, order: [] });
    const modules = [
      { __typename: "WorktrackerIssue", id: "module-1", name: "Module 1", sequenceId: 1, presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] } },
      { __typename: "WorktrackerIssue", id: "module-2", name: "Module 2", sequenceId: 2, presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] } },
    ];
    const graph = {
      project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
      states: { __typename: "WorktrackerStateConnection", nodes: [] },
      issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [{ __typename: "WorktrackerIssuetype", id: "epic", name: "Epic", level: "module" }] },
      sprints: { __typename: "WorktrackerSprintConnection", nodes: [
        { __typename: "WorktrackerSprint", id: "sprint-1", name: "First", status: "planned", createdAt: "2026-02-01" },
        { __typename: "WorktrackerSprint", id: "sprint-2", name: "Second", status: "planned", createdAt: "2026-03-01" },
      ] },
      modules: { __typename: "WorktrackerIssueConnection", nodes: modules },
      workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
    };
    const writes: unknown[] = [];
    function PlanningVisit() {
      return <>
        <button onClick={() => openPlanWorkspace("sprint-1")}>Open planning visit</button>
        <button onClick={leavePlanWorkspace}>Leave planning visit</button>
        <SprintsWorkspace renderWorkItemDetail={(id) => <p>{id}</p>}
          renderSprintGoals={() => null} renderSuggestionAgentBox={() => null} />
      </>;
    }
    mountStudio({ http, children: <PlanningVisit />, graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      switch (documentOperationName(document)) {
        case "PlanningGraph": return graph as TResult;
        case "SprintSuggestions": return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [] } } as TResult;
        case "SprintSuggestionExecution": return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: graph.sprints.nodes.map((sprint) => ({
          ...sprint, goalsRevisedAt: null, suggestionRunId: null,
          goals: { __typename: "WorktrackerSprintGoalConnection", nodes: [] },
          suggestions: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [] },
        })) } } as TResult;
        case "CreateWorkTrackerWorkItem": {
          writes.push(variables);
          http.workItems([workItem({ id: "created-epic", name: "Delivery", parent_id: null, issue_type: "epic" })]);
          graph.modules.nodes = [...graph.modules.nodes, { __typename: "WorktrackerIssue", id: "created-epic", name: "Delivery", sequenceId: 3, presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] } }];
          const result = await http.executeGraphQl(WorkTrackerWorkItemDocument, { id: "created-epic" });
          return { create_work_item: result.work_item.nodes[0] } as TResult;
        }
        default: return http.executeGraphQl(document, variables);
      }
    } });
    fireEvent.click(screen.getByRole("button", { name: "Open planning visit" }));
    await screen.findByRole("tablist", { name: "Plan epic tabs" });
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText("No epic open. Use + Add epic to plan another one.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    fireEvent.click(screen.getByRole("button", { name: "Module 1, 0 backlog stories" }));
    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    fireEvent.click(screen.getByRole("button", { name: "+ New epic" }));
    const input = screen.getByRole("textbox", { name: "New epic name" });
    fireEvent.change(input, { target: { value: " Delivery " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    const delivery = await screen.findByRole("tab", { name: "Delivery, 0 backlog stories" });
    expect(delivery).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Module 1, 0 backlog stories" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("button", { name: "Add epic" })).toHaveAttribute("aria-expanded", "false");
    expect(writes).toEqual([{ projectId: "project-1", name: "Delivery", issueTypeId: "epic", parentId: null }]);
    fireEvent.click(screen.getByRole("button", { name: "Next epic" }));
    expect(screen.getByRole("tab", { name: "Module 1, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Done with Module 1 → next" }));
    expect(screen.queryByRole("tab", { name: "Module 1, 0 backlog stories" })).not.toBeInTheDocument();
    expect(delivery).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Back to sprints" }));
    fireEvent.click(within(screen.getByTestId("sprint-card-sprint-2")).getByRole("button", { name: "Plan" }));
    await screen.findByRole("tablist", { name: "Plan epic tabs" });
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
    fireEvent.click(screen.getByRole("button", { name: "Module 2, 0 backlog stories" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to sprints" }));
    fireEvent.click(within(screen.getByTestId("sprint-card-sprint-1")).getByRole("button", { name: "Plan" }));
    expect(await screen.findByRole("tab", { name: "Delivery, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "Module 2, 0 backlog stories" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Delivery" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave planning visit" }));
    fireEvent.click(screen.getByRole("button", { name: "Open planning visit" }));
    await screen.findByRole("tablist", { name: "Plan epic tabs" });
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Back to sprints" }));
    fireEvent.click(within(screen.getByTestId("sprint-card-sprint-2")).getByRole("button", { name: "Plan" }));
    expect(await screen.findByRole("tab", { name: "Module 2, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
  });
  it("[overhaul-459] isolates Plan keys, steps epics with Option brackets and closes detail before leaving", () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    mountStudio({ http, children: <KeyboardPlan /> });
    act(() => useClientStore.setState({ sidebarVisible: false, editViewZone: "stories", editViewBodyEngaged: false }));
    act(() => usePlanWorkspace.setState({ visits: {
      "sprint-1": { epicTabs: ["module-1", "module-2"], activeEpicId: "module-1" },
    } }));
    fireEvent.click(screen.getByRole("button", { name: "Open keyboard Plan" }));
    fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true });
    expect(useClientStore.getState().editViewZone).toBe("stories");
    fireEvent.keyDown(document.body, { key: "»", code: "BracketRight", altKey: true });
    expect(screen.getByRole("tab", { name: "Other, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.body, { key: "“", code: "BracketLeft", altKey: true });
    expect(screen.getByRole("tab", { name: "Origin, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Plan typing" }), { key: "]", code: "BracketRight", altKey: true });
    expect(screen.getByRole("tab", { name: "Origin, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Open proposal" }));
    fireEvent.keyDown(document.body, { key: "Escape", shiftKey: true });
    expect(screen.getByLabelText("Open Plan detail")).toBeVisible();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByLabelText("Open Plan detail")).not.toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Plan epic tabs" })).toBeVisible();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("tablist", { name: "Plan epic tabs" })).not.toBeInTheDocument();
  });
  it("opens the next planned sprint and preserves each sprint's epic tabs after Escape", () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    mountStudio({ http, children: <PlanControls /> });
    cachePlanningGraph();
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByLabelText("Plan sprint")).toHaveTextContent("sprint-1");
    act(() => usePlanWorkspace.setState((state) => ({ visits: {
      ...state.visits, "sprint-1": { epicTabs: ["module-1", "module-2"], activeEpicId: "module-1" },
    } })));
    fireEvent.keyDown(screen.getByRole("button", { name: "Plan" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(usePlanWorkspace.getState().visits["sprint-1"]).toEqual({ epicTabs: ["module-1", "module-2"], activeEpicId: "module-1" });
    fireEvent.click(screen.getByRole("button", { name: "Second sprint" }));
    fireEvent.click(screen.getByRole("button", { name: "Sprint list" }));
    expect(usePlanWorkspace.getState()).toMatchObject({ active: true, sprintId: null, openItem: null });
  });
  it("[overhaul-408] restores the exact origin after selecting a story in another module", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: ["origin-story"], children: { "origin-story": [] }, order: ["origin-story"] });
    http.tree("module-2", { rootIds: ["other-story"], children: { "other-story": [] }, order: ["other-story"] });
    http.workItems([workItem({ id: "origin-story", parent_id: "module-1" }), workItem({ id: "other-story", parent_id: "module-2", sequence_id: 3 })]);
    mountStudio({ http, selectedTaskId: "origin-story", children: <PlanControls /> });
    await waitFor(() => expect(getModuleTreeSnapshot(null, "module-1").order).toContain("origin-story"));
    cachePlanningGraph();
    act(() => useClientStore.setState({ focusedPane: "details-or-terminal", editViewZone: "stories", editViewBodyEngaged: true, sidebarVisible: true, panelLayout: [20, 30, 50] }));
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Other story" }));
    await waitFor(() => expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-2", selectedTaskId: "other-story" }));
    fireEvent.click(screen.getByRole("button", { name: "Second sprint" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Plan" }), { key: "Escape" });
    expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-1", selectedTaskId: "origin-story", workspaceSelection: { kind: "task" }, focusedPane: "details-or-terminal", editViewZone: "stories", editViewBodyEngaged: true, sidebarVisible: true, panelLayout: [20, 30, 50] });
  });
  it("returns a deleted origin to its module's scratch Details", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: ["origin-story"], children: { "origin-story": [] }, order: ["origin-story"] });
    http.tree("module-2", { rootIds: ["other-story"], children: { "other-story": [] }, order: ["other-story"] });
    http.workItems([workItem({ id: "origin-story", parent_id: "module-1" }), workItem({ id: "other-story", parent_id: "module-2", sequence_id: 3 })]);
    mountStudio({ http, selectedTaskId: "origin-story", children: <PlanControls /> });
    await waitFor(() => expect(getModuleTreeSnapshot(null, "module-1").order).toContain("origin-story"));
    cachePlanningGraph();
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    await act(async () => { await loadModuleTree("project-1", "module-1"); });
    fireEvent.keyDown(screen.getByRole("button", { name: "Plan" }), { key: "Escape" });
    expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-1", selectedTaskId: TEMP_TASK_ID });
    expect(useClientStore.getState().workspaces[scratchBucketId("module-1")]?.active).toBe("details");
  });
  it("keeps a cold-cache default pending until the graph arrives and cancels it on list navigation", () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    mountStudio({ http, children: <PlanControls /> });
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(usePlanWorkspace.getState()).toMatchObject({ sprintId: null, defaultSprintPending: true, visits: {} });
    cachePlanningGraph();
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(usePlanWorkspace.getState()).toMatchObject({ sprintId: "sprint-1", defaultSprintPending: false });
    fireEvent.click(screen.getByRole("button", { name: "Sprint list" }));
    expect(usePlanWorkspace.getState()).toMatchObject({ sprintId: null, defaultSprintPending: false });
  });
  it("does not publish a story or replace the origin when its module finishes loading after Escape", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    http.tree("module-2", { rootIds: ["other-story"], children: { "other-story": [] }, order: ["other-story"] });
    http.workItems([workItem({ id: "other-story", parent_id: "module-2", sequence_id: 3 })]);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mountStudio({ http, children: <PlanControls />, graphQlExecute: async (document, variables) => {
      if (documentOperationName(document) === "WorkTrackerModuleOpen" && typeof variables === "object" && variables !== null && "moduleId" in variables && variables.moduleId === "module-2") await gate;
      return http.executeGraphQl(document, variables);
    } });
    cachePlanningGraph();
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    let opening: Promise<void> = Promise.resolve();
    act(() => { opening = openPlanItem("other-story"); });
    expect(usePlanWorkspace.getState().openItem).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Plan" }), { key: "Escape" });
    await act(async () => { release(); await opening; });
    expect(usePlanWorkspace.getState()).toMatchObject({ active: false, openItem: null });
    expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-1", selectedTaskId: null });
  });

  it("[overhaul-452] ignores an old load when the same item is reopened after Escape", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    http.tree("module-2", { rootIds: ["other-story"], children: { "other-story": [] }, order: ["other-story"] });
    http.workItems([workItem({ id: "other-story", parent_id: "module-2", sequence_id: 3 })]);
    let releaseOld = () => {}; let releaseNew = () => {};
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const newGate = new Promise<void>((resolve) => { releaseNew = resolve; });
    let holdNewModule = false;
    mountStudio({ http, children: <PlanControls />, graphQlExecute: async (document, variables) => {
      if (documentOperationName(document) === "WorkTrackerModuleOpen" && typeof variables === "object" && variables !== null && "moduleId" in variables) {
        if (variables.moduleId === "module-2") await oldGate;
        if (variables.moduleId === "module-1" && holdNewModule) await newGate;
      }
      return http.executeGraphQl(document, variables);
    } });
    await act(async () => { await loadModuleTree("project-1", "module-1"); });
    cachePlanningGraph();
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    let oldOpening: Promise<void> = Promise.resolve();
    act(() => { oldOpening = openPlanItem("other-story"); });
    fireEvent.keyDown(screen.getByRole("button", { name: "Plan" }), { key: "Escape" });
    cachePlanningGraph("module-1");
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    holdNewModule = true;
    let newOpening: Promise<void> = Promise.resolve();
    act(() => { newOpening = openPlanItem("other-story"); });
    await act(async () => { releaseOld(); await oldOpening; });
    expect(usePlanWorkspace.getState()).toMatchObject({ active: true, openItem: null, pendingOpenItem: "other-story" });
    expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-1", selectedTaskId: null });
    await act(async () => { releaseNew(); await newOpening; });
    expect(usePlanWorkspace.getState()).toMatchObject({ openItem: "other-story", pendingOpenItem: null });
    expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-1", selectedTaskId: "other-story" });
  });

  it("[overhaul-451] opens a suggestion's moduleless story in the first visible module", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: ["other-story"], children: { "other-story": [] }, order: ["other-story"] });
    http.tree("module-2", { rootIds: [], children: {}, order: [] });
    http.workItems([workItem({ id: "other-story", parent_id: null, sequence_id: 3 })]);
    mountStudio({ http, children: <PlanControls /> });
    await waitFor(() => expect(getModuleTreeSnapshot(null, "module-1").order).toContain("other-story"));
    await act(async () => { await loadModules("project-1"); });
    cachePlanningGraph(null);
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    await act(async () => { await openPlanItem("other-story", "proposal-1"); });
    expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-1", selectedTaskId: "other-story" });
    expect(usePlanWorkspace.getState()).toMatchObject({ openItem: "suggestion:proposal-1", pendingOpenItem: null });
  });

});
