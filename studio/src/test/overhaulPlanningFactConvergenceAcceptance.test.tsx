import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkItemInvalidator, type WorkItemInvalidator } from "../features/agents/status/stream/workItemInvalidation";
import type { WorkItemFact } from "../features/agents/status/stream/statusFacts";
import type { PlanningGraphQuery } from "../features/planning-graph/generated/planningGraph.documents";
import SprintsView from "../features/sprints/SprintsView";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import type { WorkTrackerProjectOpenQuery } from "../features/projects/generated/projects.documents";
import type { WorkTrackerModuleOpenQuery, WorkTrackerWorkItemQuery } from "../features/work-items/generated/workItems.documents";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { fixture, mountStudio, workItem } from "./seam";

let invalidator: WorkItemInvalidator;
beforeEach(() => {
  usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true);
  invalidator = createWorkItemInvalidator();
});
afterEach(() => invalidator.cancel());

function fact(workItemId: string, overrides: Partial<WorkItemFact> = {}): WorkItemFact {
  return { family: "work_item", workItemId, projectId: "project-1", moduleId: "module-1",
    itemKind: "task", removed: false, membershipChanged: true, occurredAt: null, ...overrides };
}

function planner() {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  const memberships = new Map<string, string | null>();
  let epicName = "Epic";
  let hasEpic = true;
  let graphGate: Promise<void> | null = null;
  const graphReads: string[] = [];
  const canonicalReads: string[] = [];
  function add(id: string, name: string, sprintId = "active-sprint", done = false) {
    http.workItems([workItem({ id, name, state: done
      ? { id: "done", name: "Done", group: "completed", color: "#00ff00" }
      : { id: "state-1", name: "Implement", group: "started", color: "#0000ff" } })]);
    memberships.set(id, sprintId);
  }
  function graph(projectId: string) {
    const response = {
      project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: projectId, name: "Planner", slug: "PLAN" }] },
      states: { __typename: "WorktrackerStateConnection", nodes: [
        { __typename: "WorktrackerState", id: "state-1", name: "Implement", group: "started", color: "#0000ff", sortOrder: 0 },
        { __typename: "WorktrackerState", id: "done", name: "Done", group: "completed", color: "#00ff00", sortOrder: 1 },
      ] },
      issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [{ __typename: "WorktrackerIssuetype", id: "story", name: "Story", level: "task" }] },
      sprints: { __typename: "WorktrackerSprintConnection", nodes: [
        { __typename: "WorktrackerSprint", id: "active-sprint", name: "Current", status: "active", createdAt: "2026-10-01" },
        { __typename: "WorktrackerSprint", id: "next-sprint", name: "Next", status: "planned", createdAt: "2026-10-02" },
      ] },
      modules: { __typename: "WorktrackerIssueConnection", nodes: hasEpic ? [{ __typename: "WorktrackerIssue", id: "module-1", name: epicName, sequenceId: 1, presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] } }] : [] },
      workItems: { __typename: "WorktrackerIssueConnection", nodes: [...http.items.values()].filter((item) => !item.is_archived && item.project_id === projectId)
        .map((item) => ({ __typename: "WorktrackerIssue", id: item.id, name: item.name,
          sequenceId: item.sequence_id, rank: item.rank, parentId: item.parent_id ?? null,
          moduleId: "module-1", stateId: item.state ?? null, stateRevision: 1,
          sprintId: memberships.get(item.id) ?? null, updatedAt: item.updated_at,
          issueType: { __typename: "WorktrackerIssuetype", id: item.issue_type, name: "Story" } })) },
    };
    return response satisfies PlanningGraphQuery;
  }
  const execute = async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
    const operation = documentOperationName(document);
    if (operation === "PlanningGraph") {
      const { projectId } = variables as { projectId: string };
      graphReads.push(projectId);
      if (graphGate) await graphGate;
      return graph(projectId) as TResult;
    }
    const result = await http.executeGraphQl(document, variables);
    if (operation === "WorkTrackerProjectOpen") {
      const response = result as WorkTrackerProjectOpenQuery;
      return { ...response, modules: { ...response.modules, nodes: hasEpic
        ? response.modules.nodes.map((row) => ({ ...row, name: epicName })) : [] } } as TResult;
    }
    if (operation === "WorkTrackerModuleOpen") {
      const response = result as WorkTrackerModuleOpenQuery;
      return { ...response, module: { ...response.module, nodes: hasEpic
        ? response.module.nodes.map((row) => ({ ...row, name: epicName })) : [] } } as TResult;
    }
    if (operation === "WorkTrackerWorkItem") {
      const response = result as WorkTrackerWorkItemQuery;
      canonicalReads.push(...response.work_item.nodes.map((row) => row.id));
      return { ...response, work_item: { ...response.work_item,
        nodes: response.work_item.nodes.map((row) => ({ ...row,
          sprint_id: memberships.get(row.id) ?? null, sprintId: memberships.get(row.id) ?? null })) } } as TResult;
    }
    return result;
  };
  function mount(otherProject = false) {
    return mountStudio({ http, graphQlExecute: execute, children: <>
      <section aria-label="Primary planning"><SprintsView projectId="project-1"
        renderSprintGoals={() => null} renderSuggestionAgentBox={() => null} /></section>
      {otherProject && <section aria-label="Other planning"><SprintsView projectId="project-2"
        renderSprintGoals={() => null} renderSuggestionAgentBox={() => null} /></section>}
    </> });
  }
  function holdGraph() {
    let release = () => {};
    graphGate = new Promise<void>((resolve) => { release = () => { graphGate = null; resolve(); }; });
    return release;
  }
  return { http, add, mount, memberships, graphReads, canonicalReads, holdGraph,
    renameEpic: (name: string) => { epicName = name; }, removeEpic: () => { hasEpic = false; } };
}

function current() { return within(screen.getByTestId("sprint-card-active-sprint")); }
function preview() { return within(screen.getByRole("dialog", { name: "Complete Current" })); }
function publish(...facts: WorkItemFact[]) {
  act(() => { facts.forEach((event) => invalidator.record(event)); invalidator.flush(); });
}

describe("planning collections converge after external work-item facts", () => {
  it("[overhaul-415] removes externally archived rows and updates an open completion preview once per project batch", async () => {
    const server = planner();
    server.add("archive-a", "Archive A");
    server.add("archive-b", "Archive B");
    server.add("keep", "Finished Story", "active-sprint", true);
    server.mount();
    await screen.findByTestId("sprint-card-active-sprint");
    expect(current().getByText("1/3 done")).toBeVisible();
    fireEvent.click(current().getByRole("button", { name: "Complete" }));
    expect(preview().getByText("1 done · 2 unfinished")).toBeVisible();
    server.http.revise("archive-a", { is_archived: true });
    server.http.revise("archive-b", { is_archived: true });
    publish(fact("archive-a"), fact("archive-b"), fact("archive-a"));
    await waitFor(() => {
      expect(current().queryByRole("button", { name: /Archive A/ })).toBeNull();
      expect(current().queryByRole("button", { name: /Archive B/ })).toBeNull();
      expect(current().getByRole("button", { name: /Finished Story/ })).toBeVisible();
      expect(current().getByText("1/1 done")).toBeVisible();
      expect(preview().getByText("1 done · 0 unfinished")).toBeVisible();
    });
    expect(server.graphReads).toEqual(["project-1", "project-1"]);
    expect(server.canonicalReads.filter((id) => id === "archive-a")).toHaveLength(1);
  });

  it("[overhaul-416] inserts an externally created assigned Story into rows, counts and completion preview", async () => {
    const server = planner();
    server.add("keep", "Finished Story", "active-sprint", true);
    server.mount();
    await screen.findByTestId("sprint-card-active-sprint");
    fireEvent.click(current().getByRole("button", { name: "Complete" }));
    expect(preview().getByText("Everything in this sprint is done.")).toBeVisible();
    server.add("created", "Externally Created Story");
    publish(fact("created"));
    await waitFor(() => {
      expect(current().getByRole("button", { name: /Externally Created Story/ })).toBeVisible();
      expect(current().getByText("1/2 done")).toBeVisible();
      expect(preview().getByText("1 done · 1 unfinished")).toBeVisible();
      expect(preview().getByRole("combobox", { name: "Move 1 unfinished item to" })).toBeVisible();
    });
    expect(server.graphReads).toEqual(["project-1", "project-1"]);
  });

  it("[overhaul-417] refreshes canonical sprint membership even when membershipChanged is false", async () => {
    const server = planner();
    server.add("moving", "Moving Story");
    server.mount();
    await screen.findByTestId("sprint-card-active-sprint");
    fireEvent.click(current().getByRole("button", { name: "Complete" }));
    expect(preview().getByText("0 done · 1 unfinished")).toBeVisible();
    const releaseGraph = server.holdGraph();
    server.memberships.set("moving", "next-sprint");
    server.http.revise("moving", { updated_at: "2026-10-03T10:00:00Z" });
    try {
      publish(fact("moving", { membershipChanged: false }));
      await waitFor(() => {
        expect(current().queryByRole("button", { name: /Moving Story/ })).toBeNull();
        expect(within(screen.getByTestId("sprint-card-next-sprint")).getByRole("button", { name: /Moving Story/ })).toBeVisible();
        expect(current().getByText("0/0 done")).toBeVisible();
        expect(preview().getByText("0 done · 0 unfinished")).toBeVisible();
      });
      expect(server.canonicalReads).toContain("moving");
    } finally { await act(async () => releaseGraph()); }
  });

  it("[overhaul-418] reopens an inactive cached planning collection with external creates and archives applied", async () => {
    const server = planner();
    server.add("old", "Old Assigned Story");
    const mounted = server.mount();
    await screen.findByTestId("sprint-card-active-sprint");
    mounted.rerender(<StudioApolloProvider><p>Planning closed</p></StudioApolloProvider>);
    server.http.revise("old", { is_archived: true });
    server.add("new", "New Assigned Story");
    publish(fact("old"), fact("new"));
    await waitFor(() => expect(server.canonicalReads).toEqual(expect.arrayContaining(["old", "new"])));
    mounted.rerender(<StudioApolloProvider><SprintsView projectId="project-1"
      renderSprintGoals={() => null} renderSuggestionAgentBox={() => null} /></StudioApolloProvider>);
    await waitFor(() => {
      expect(current().queryByRole("button", { name: /Old Assigned Story/ })).toBeNull();
      expect(current().getByRole("button", { name: /New Assigned Story/ })).toBeVisible();
      expect(current().getByText("0/1 done")).toBeVisible();
    });
    expect(server.graphReads).toEqual(["project-1", "project-1"]);
  });

  it("[overhaul-419] refreshes epic names and removes archived epics from planning groups", async () => {
    const server = planner();
    server.add("story", "Assigned Story");
    server.mount();
    await screen.findByTestId("sprint-card-active-sprint");
    server.renameEpic("Renamed Epic");
    publish(fact("module-1", { itemKind: "module", membershipChanged: false }));
    await waitFor(() => expect(current().getByRole("heading", { name: "Renamed Epic" })).toBeVisible());
    server.removeEpic();
    publish(fact("module-1", { itemKind: "module", removed: true }));
    await waitFor(() => {
      expect(current().queryByRole("heading", { name: "Renamed Epic" })).toBeNull();
      expect(current().getByRole("heading", { name: "No epic" })).toBeVisible();
      expect(current().getByRole("button", { name: /Assigned Story/ })).toBeVisible();
    });
    expect(server.graphReads).toEqual(["project-1", "project-1", "project-1"]);
  });

  it("[overhaul-420] refreshes only the affected project when two planning views are active", async () => {
    const server = planner();
    server.add("story", "Project One Story");
    server.mount(true);
    const primary = within(screen.getByRole("region", { name: "Primary planning" }));
    const other = within(screen.getByRole("region", { name: "Other planning" }));
    await primary.findByTestId("sprint-card-active-sprint");
    await other.findByTestId("sprint-card-active-sprint");
    server.http.revise("story", { is_archived: true });
    publish(fact("story"), fact("story"));
    await waitFor(() => {
      expect(primary.queryByRole("button", { name: /Project One Story/ })).toBeNull();
      expect(within(primary.getByTestId("sprint-card-active-sprint")).getByText("0/0 done")).toBeVisible();
    });
    expect(within(other.getByTestId("sprint-card-active-sprint")).getByText("0/0 done")).toBeVisible();
    expect(server.graphReads.filter((id) => id === "project-1")).toHaveLength(2);
    expect(server.graphReads.filter((id) => id === "project-2")).toHaveLength(1);
  });

  it("[overhaul-421] removes an externally deleted Story without fetching its deleted identity", async () => {
    const server = planner();
    server.add("deleted", "Deleted Story");
    server.add("keep", "Finished Story", "active-sprint", true);
    server.mount();
    await screen.findByTestId("sprint-card-active-sprint");
    fireEvent.click(current().getByRole("button", { name: "Complete" }));
    if (!(server.http.items instanceof Map)) throw new Error("The server fixture must expose its rows.");
    server.http.items.delete("deleted");
    publish(fact("deleted", { removed: true }));
    await waitFor(() => {
      expect(current().queryByRole("button", { name: /Deleted Story/ })).toBeNull();
      expect(current().getByRole("button", { name: /Finished Story/ })).toBeVisible();
      expect(current().getByText("1/1 done")).toBeVisible();
      expect(preview().getByText("1 done · 0 unfinished")).toBeVisible();
    });
    expect(server.canonicalReads).not.toContain("deleted");
    expect(server.graphReads).toEqual(["project-1", "project-1"]);
  });

});
