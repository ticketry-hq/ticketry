import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { loadModules } from "../features/projects";
import { PlanningGraphDocument } from "../features/planning-graph";
import { closePlanSprint, leavePlanWorkspace, openPlanItem, openPlanSprint, openPlanWorkspace, usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { studioApolloClient } from "../shared/apollo/client";
import { useClientStore } from "../state/clientStore";
import { getModuleTreeSnapshot, loadModuleTree } from "../features/work-items";
import { TEMP_TASK_ID, scratchBucketId } from "../features/agents/terminal";
import { fixture, mountStudio, workItem } from "./seam";

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

  it("opens a suggestion's moduleless story in the first visible module", async () => {
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
