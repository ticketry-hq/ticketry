import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { openPlanSprint, usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { PlanningGraphDocument } from "../features/planning-graph";
import { WorkTrackerWorkItemDocument } from "../features/work-items/generated/workItems.documents";
import { studioApolloClient } from "../shared/apollo/client";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";
import { planningProjectOpenFixture } from "./planningProjectOpenFixture";

function planningGraph(epics = ["Alpha", "Beta", "Gamma"], sprintIds = ["sprint"]) {
  return {
    project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
    states: { __typename: "WorktrackerStateConnection", nodes: [] },
    issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [{ __typename: "WorktrackerIssuetype", id: "epic-type", name: "Epic", level: "module" }] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: epics.map((name) => ({ __typename: "WorktrackerIssue", id: name.toLowerCase(), name, sequenceId: name.length, presentation: { __typename: "WorktrackerModulePresentationConnection", nodes: [] } })) },
    sprints: { __typename: "WorktrackerSprintConnection", nodes: sprintIds.map((id) => ({ __typename: "WorktrackerSprint", id, name: id, status: "planned", rank: "V", createdAt: "2026-10-04" })) },
    workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
  };
}

function addEpic(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: `${name}, 0 backlog stories` }));
}

function beginCreation() {
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "+ New epic" }));
  const input = screen.getByRole("textbox", { name: "New epic name" });
  fireEvent.change(input, { target: { value: "Delivery" } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function mountPlan(options: {
  graph?: () => ReturnType<typeof planningGraph>;
  suggestions?: (sprintId: string) => Promise<unknown[]>;
  create?: () => Promise<string>;
} = {}) {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  function Visits() {
    const { sprintId } = usePlanWorkspace();
    return <><button onClick={() => openPlanSprint("sprint")}>First sprint</button>
      <button onClick={() => openPlanSprint("second")}>Second sprint</button>
      {sprintId && <PlanSprintView projectId="project-1" sprintId={sprintId} renderWorkItemDetail={() => null} />}</>;
  }
  mountStudio({ http, children: <Visits />, graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
    switch (documentOperationName(document)) {
      case "PlanningGraph": return (options.graph?.() ?? planningGraph(undefined, ["sprint", "second"])) as TResult;
      case "WorkTrackerProjectOpen": return planningProjectOpenFixture(http, document, variables, options.graph?.() ?? planningGraph(undefined, ["sprint", "second"]));
      case "SprintSuggestions": return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: await options.suggestions?.((variables as { sprintId: string }).sprintId) ?? [] } } as TResult;
      case "SprintSuggestionExecution": return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [] } } as TResult;
      case "CreateWorkTrackerWorkItem": {
        const id = await options.create?.() ?? "delivery";
        http.workItems([workItem({ id, name: "Delivery", parent_id: null })]);
        const result = await http.executeGraphQl(WorkTrackerWorkItemDocument, { id });
        return { create_work_item: result.work_item.nodes[0] } as TResult;
      }
      default: return http.executeGraphQl(document, variables);
    }
  } });
  fireEvent.click(screen.getByRole("button", { name: "First sprint" }));
}

async function refreshGraph() {
  await act(async () => { await studioApolloClient().refetchQueries({ include: [PlanningGraphDocument] }); });
}

beforeEach(() => usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true));

it("[overhaul-737] keeps a created epic selected until its identity arrives in the planning graph", async () => {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  let published = false;
  let creationWrites = 0;
  mountStudio({ http, children: <PlanSprintView projectId="project-1" sprintId="sprint" renderWorkItemDetail={() => null} />,
    graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      switch (documentOperationName(document)) {
        case "PlanningGraph": return planningGraph(published ? ["Alpha", "Delivery"] : ["Alpha"]) as TResult;
        case "WorkTrackerProjectOpen": return planningProjectOpenFixture(http, document, variables, planningGraph(published ? ["Alpha", "Delivery"] : ["Alpha"]));
        case "SprintSuggestions": return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [] } } as TResult;
        case "SprintSuggestionExecution": return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [] } } as TResult;
        case "CreateWorkTrackerWorkItem": {
          creationWrites += 1;
          http.workItems([workItem({ id: "delivery", name: "Delivery", parent_id: null })]);
          const result = await http.executeGraphQl(WorkTrackerWorkItemDocument, { id: "delivery" });
          return { create_work_item: result.work_item.nodes[0] } as TResult;
        }
        default: return http.executeGraphQl(document, variables);
      }
    },
  });
  act(() => openPlanSprint("sprint"));
  await screen.findByTestId("plan-sprint");
  addEpic("Alpha");
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "+ New epic" }));
  const input = screen.getByRole("textbox", { name: "New epic name" });
  fireEvent.change(input, { target: { value: "Delivery" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(creationWrites).toBe(1));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "New epic name" })).not.toBeInTheDocument());
  expect(usePlanWorkspace.getState().visits.sprint).toEqual({ epicTabs: ["alpha", "delivery"], activeEpicId: "delivery" });
  expect(screen.getByRole("tab", { selected: true })).toBeVisible();
  published = true;
  await refreshGraph();
  expect(screen.getByRole("tab", { name: "Delivery, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
  expect(creationWrites).toBe(1);
});

it("[overhaul-739] preserves a saved visit while suggestion results are incomplete or fail", async () => {
  const saved = { epicTabs: ["beta"], activeEpicId: "beta" };
  usePlanWorkspace.setState({ visits: { sprint: saved } });
  let rejectSuggestions = (_error: Error) => {};
  const results = new Promise<unknown[]>((_resolve, reject) => { rejectSuggestions = reject; });
  mountPlan({ graph: () => planningGraph(["Alpha"]), suggestions: () => results });
  await screen.findByTestId("plan-sprint");
  expect(usePlanWorkspace.getState().visits.sprint).toEqual(saved);
  expect(screen.getByRole("tab", { selected: true })).toBeVisible();
  await act(async () => { rejectSuggestions(new Error("Suggestion read unavailable")); });
  expect(await screen.findByRole("alert")).toHaveTextContent("Suggestion read unavailable");
  expect(usePlanWorkspace.getState().visits.sprint).toEqual(saved);
  expect(screen.getByRole("tab", { selected: true })).toBeVisible();
});

it("[overhaul-740] normalizes deleted epics once and leaves waiting suggestions discoverable after closure", async () => {
  usePlanWorkspace.setState({ visits: { sprint: { epicTabs: ["deleted-a", "alpha", "deleted-b"], activeEpicId: "deleted-b" } } });
  const waiting = { __typename: "WorktrackerSprintSuggestion", id: "suggestion", sprintId: "sprint", goalId: "goal",
    issueId: null, proposedName: "New story", proposedEpicId: "deleted-a", reason: "Useful", status: "waiting",
    runId: "run", createdAt: "2026-10-04", issue: null };
  mountPlan({ graph: () => planningGraph(["Alpha"]), suggestions: async () => [waiting] });
  const noEpic = await screen.findByRole("tab", { name: "No epic, 0 backlog stories, 1 waiting suggestions" });
  expect(noEpic).toHaveAttribute("aria-selected", "true");
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  expect(usePlanWorkspace.getState().visits.sprint).toEqual({ epicTabs: ["__no_epic__", "alpha"], activeEpicId: "__no_epic__" });
  fireEvent.click(screen.getByRole("button", { name: "Close No epic" }));
  expect(screen.getByRole("tab", { name: "Alpha, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  expect(screen.getByRole("button", { name: "No epic, 0 backlog stories, 1 waiting suggestions" })).toBeVisible();
});

it("[overhaul-741] restores sprint visits and ignores a creation that completes after switching visits", async () => {
  let releaseCreation = (_id: string) => {};
  const creation = new Promise<string>((resolve) => { releaseCreation = resolve; });
  mountPlan({ create: () => creation });
  await screen.findByTestId("plan-sprint");
  addEpic("Alpha");
  beginCreation();
  fireEvent.click(screen.getByRole("button", { name: "Second sprint" }));
  await screen.findByTestId("plan-sprint");
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  addEpic("Beta");
  const beta = screen.getByRole("tab", { name: "Beta, 0 backlog stories" });
  act(() => beta.focus());
  await act(async () => { releaseCreation("delivery"); await creation; });
  expect(beta).toHaveAttribute("aria-selected", "true");
  expect(beta).toHaveFocus();
  expect(usePlanWorkspace.getState().visits.sprint).toEqual({ epicTabs: ["alpha"], activeEpicId: "alpha" });
  fireEvent.click(screen.getByRole("button", { name: "First sprint" }));
  expect(await screen.findByRole("tab", { name: "Alpha, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("tab", { name: /Delivery/ })).not.toBeInTheDocument();
});

it("[overhaul-742] retries a created epic's refresh without taking a newer selection", async () => {
  let failRefresh = false;
  let created = false;
  mountPlan({ graph: () => {
    if (failRefresh) throw new Error("Planning graph unavailable");
    return planningGraph(created ? ["Alpha", "Beta", "Delivery"] : ["Alpha", "Beta"]);
  }, create: async () => { created = true; failRefresh = true; return "delivery"; } });
  await screen.findByTestId("plan-sprint");
  addEpic("Alpha");
  addEpic("Beta");
  fireEvent.click(screen.getByRole("tab", { name: "Alpha, 0 backlog stories" }));
  beginCreation();
  expect(await screen.findByRole("button", { name: "Retry refresh" })).toBeVisible();
  failRefresh = false;
  await refreshGraph();
  fireEvent.click(screen.getByRole("tab", { name: "Beta, 0 backlog stories" }));
  expect(screen.getByRole("tab", { name: "Beta, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "New epic name" })).not.toBeInTheDocument());
  expect(screen.getByRole("tab", { name: "Beta, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
  expect(usePlanWorkspace.getState().visits.sprint).toEqual({ epicTabs: ["alpha", "beta"], activeEpicId: "beta" });
});

it("[overhaul-743] retains remembered intent when a refreshed graph no longer contains the Plan sprint", async () => {
  let available = true;
  mountPlan({ graph: () => available ? planningGraph() : planningGraph([], []) });
  await screen.findByTestId("plan-sprint");
  addEpic("Beta");
  available = false;
  await refreshGraph();
  expect(screen.getByText("Sprint not found.")).toHaveAttribute("role", "status");
  expect(screen.queryByRole("tablist", { name: "Plan epic tabs" })).not.toBeInTheDocument();
  expect(usePlanWorkspace.getState().visits.sprint).toEqual({ epicTabs: ["beta"], activeEpicId: "beta" });
  available = true;
  await refreshGraph();
  expect(screen.getByRole("tab", { name: "Beta, 0 backlog stories" })).toHaveAttribute("aria-selected", "true");
});

it("[overhaul-744] keeps a newer selection while an epic creation from the same visit is in flight", async () => {
  let releaseCreation = (_id: string) => {};
  const creation = new Promise<string>((resolve) => { releaseCreation = resolve; });
  let created = false;
  mountPlan({ graph: () => planningGraph(created ? ["Alpha", "Beta", "Delivery"] : ["Alpha", "Beta"]), create: async () => {
    const id = await creation; created = true; return id;
  } });
  await screen.findByTestId("plan-sprint");
  addEpic("Alpha");
  addEpic("Beta");
  fireEvent.click(screen.getByRole("tab", { name: "Alpha, 0 backlog stories" }));
  beginCreation();
  const beta = screen.getByRole("tab", { name: "Beta, 0 backlog stories" });
  fireEvent.click(beta);
  act(() => beta.focus());
  await act(async () => { releaseCreation("delivery"); await creation; });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "New epic name" })).not.toBeInTheDocument());
  expect(beta).toHaveAttribute("aria-selected", "true");
  expect(beta).toHaveFocus();
  expect(usePlanWorkspace.getState().visits.sprint).toEqual({ epicTabs: ["alpha", "beta"], activeEpicId: "beta" });
});

it("[overhaul-746] ignores a creation captured before reopening the same sprint generation", async () => {
  let releaseCreation = (_id: string) => {};
  const creation = new Promise<string>((resolve) => { releaseCreation = resolve; });
  let created = false;
  mountPlan({ graph: () => planningGraph(created ? ["Alpha", "Delivery"] : ["Alpha"]), create: async () => {
    const id = await creation; created = true; return id;
  } });
  await screen.findByTestId("plan-sprint");
  addEpic("Alpha");
  beginCreation();
  fireEvent.click(screen.getByRole("button", { name: "First sprint" }));
  const alpha = await screen.findByRole("tab", { name: "Alpha, 0 backlog stories" });
  act(() => alpha.focus());
  await act(async () => { releaseCreation("delivery"); await creation; });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "New epic name" })).not.toBeInTheDocument());
  expect(alpha).toHaveAttribute("aria-selected", "true");
  expect(alpha).toHaveFocus();
  expect(usePlanWorkspace.getState().visits.sprint).toEqual({ epicTabs: ["alpha"], activeEpicId: "alpha" });
});

it("[overhaul-738] keeps inactive closure focus and gives Done the same next, previous and final neighbors", async () => {
  mountPlan();
  await screen.findByTestId("plan-sprint");
  for (const name of ["Alpha", "Beta", "Gamma"]) addEpic(name);
  fireEvent.click(screen.getByRole("tab", { name: "Beta, 0 backlog stories" }));
  fireEvent.click(screen.getByRole("button", { name: "Close Alpha" }));
  const beta = screen.getByRole("tab", { name: "Beta, 0 backlog stories" });
  expect(beta).toHaveAttribute("aria-selected", "true");
  expect(beta).toHaveFocus();
  addEpic("Alpha");
  fireEvent.click(beta);
  fireEvent.click(screen.getByRole("button", { name: "Close Beta" }));
  const gamma = screen.getByRole("tab", { name: "Gamma, 0 backlog stories" });
  expect(gamma).toHaveAttribute("aria-selected", "true");
  expect(gamma).toHaveFocus();
  addEpic("Beta");
  fireEvent.click(screen.getByRole("tab", { name: "Gamma, 0 backlog stories" }));
  fireEvent.click(screen.getByRole("button", { name: "Done with Gamma → next" }));
  const alpha = screen.getByRole("tab", { name: "Alpha, 0 backlog stories" });
  await waitFor(() => expect(alpha).toHaveFocus());
  expect(alpha).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("tab", { name: "Beta, 0 backlog stories" }));
  fireEvent.click(screen.getByRole("button", { name: "Done with Beta → next" }));
  await waitFor(() => expect(alpha).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "Done with Alpha" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Add epic" })).toHaveFocus());
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  expect(within(screen.getByTestId("plan-backlog")).getByText("No epic open. Use + Add epic to plan another one.")).toBeVisible();
});
