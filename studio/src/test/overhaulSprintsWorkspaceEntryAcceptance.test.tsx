import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { SprintsWorkspace, openPlanWorkspace, usePlanWorkspace } from "../features/sprints";
import { closePlanSprint } from "../features/sprints/planWorkspaceState";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio } from "./seam";
import { useStudioStore } from "../features/projects";
import { useClientStore } from "../state/clientStore";

const graph = {
  project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planning", slug: "PLAN" }] },
  states: { __typename: "WorktrackerStateConnection", nodes: [] },
  issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] },
  modules: { __typename: "WorktrackerIssueConnection", nodes: [{ __typename: "WorktrackerIssue", id: "module-1", name: "Module", sequenceId: 1,
    presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] } }] },
  workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
  sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ __typename: "WorktrackerSprint", id: "sprint-1", name: "First sprint", status: "planned", rank: "V", createdAt: "2026-01-01" }] },
};

function workspaceFixture(planning = graph) {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  mountStudio({ http, children: <SprintsWorkspace renderWorkItemDetail={(id) => <p>Ticket {id}</p>} />,
    graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      const operation = documentOperationName(document);
      if (operation === "PlanningGraph") { await pending; return planning as TResult; }
      if (operation === "SprintGoals") return { worktrackerSprintGoal: { __typename: "WorktrackerSprintGoalConnection", nodes: [] } } as TResult;
      if (operation === "SprintSuggestions") return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [] } } as TResult;
      if (operation === "SprintSuggestionExecution") return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [] } } as TResult;
      return http.executeGraphQl(document, variables);
    },
  });
  return release;
}

describe("Plan public workspace entry", () => {
  beforeEach(() => usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true));

  it("[overhaul-445] opens the next planned sprint when the cold planning graph arrives", async () => {
    const release = workspaceFixture();
    act(() => openPlanWorkspace());
    expect(usePlanWorkspace.getState().defaultSprintPending).toBe(true);
    await act(async () => { release(); });
    await waitFor(() => expect(usePlanWorkspace.getState().sprintId).toBe("sprint-1"));
    expect(await screen.findByTestId("plan-sprint")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "First sprint", level: 1 })).toBeInTheDocument();
  });

  it("[overhaul-659] opens the first planned sprint by persisted rank in a warm workspace", async () => {
    const release = workspaceFixture({ ...graph, sprints: { ...graph.sprints, nodes: [
      { ...graph.sprints.nodes[0], id: "later", name: "Later sprint", rank: "a0", createdAt: "2026-01-01" },
      { ...graph.sprints.nodes[0], id: "first", name: "First in sequence", rank: "Z0", createdAt: "2026-01-03" },
    ] } });
    act(() => openPlanWorkspace("later"));
    await act(async () => { release(); });
    await screen.findByRole("heading", { name: "Later sprint", level: 1 });
    act(() => openPlanWorkspace());
    await waitFor(() => expect(usePlanWorkspace.getState().sprintId).toBe("first"));
    expect(await screen.findByRole("heading", { name: "First in sequence", level: 1 })).toBeVisible();
  });

  it("[overhaul-446] keeps the sprint list after explicitly cancelling the cold default", async () => {
    const release = workspaceFixture();
    act(() => { openPlanWorkspace(); closePlanSprint(); });
    await act(async () => { release(); });
    expect(await screen.findByRole("heading", { name: "Sprints" })).toBeInTheDocument();
    expect(usePlanWorkspace.getState().sprintId).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(await screen.findByTestId("plan-sprint")).toBeInTheDocument();
  });

  it("[overhaul-447] leaves the old project's workspace without restoring its origin over a new selection", async () => {
    const release = workspaceFixture();
    act(() => openPlanWorkspace());
    act(() => {
      useClientStore.setState({ selectedModuleId: "other-module", selectedTaskId: "other-ticket" });
      useStudioStore.setState({ selectedProjectId: "other-project" });
    });
    await waitFor(() => expect(usePlanWorkspace.getState().active).toBe(false));
    await act(async () => { release(); });
    expect(usePlanWorkspace.getState().sprintId).toBeNull();
    expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "other-module", selectedTaskId: "other-ticket" });
    expect(screen.queryByTestId("plan-sprint")).not.toBeInTheDocument();
  });
});
