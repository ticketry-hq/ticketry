import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import type { PlanningGraphQuery } from "../features/planning-graph/generated/planningGraph.documents";
import SprintsView from "../features/sprints/SprintsView";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { fixture, mountStudio } from "./seam";

const createdSprint: PlanningGraphQuery["sprints"]["nodes"][number] = {
  id: "created-sprint", name: "Release", status: "planned", createdAt: "2026-10-03",
};
const emptyGraph: PlanningGraphQuery = {
  project: { nodes: [{ id: "project-1", name: "Planner", slug: "PLAN" }] },
  states: { nodes: [] },
  issueTypes: { nodes: [] },
  sprints: { nodes: [] },
  modules: { nodes: [] },
  workItems: { nodes: [] },
};

function SprintDestination() {
  const workspace = usePlanWorkspace();
  return <output aria-label="Plan sprint">{workspace.sprintId ?? "list"}</output>;
}

describe("SprintsView operation and navigation acceptance", () => {
  beforeEach(() => usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true));
  it("[overhaul-413] waits for the refreshed planning graph before opening a newly created sprint", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    let releaseGraph = () => {};
    const graphGate = new Promise<void>((resolve) => { releaseGraph = resolve; });
    let graphRequests = 0;
    let creationVariables: unknown;
    mountStudio({ http, children: <><SprintsView projectId="project-1"
      renderSprintGoals={() => null} renderSuggestionAgentBox={() => null} /><SprintDestination /></>,
    graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      const operation = documentOperationName(document);
      if (operation === "PlanningGraph") {
        graphRequests += 1;
        if (graphRequests > 1) await graphGate;
        const graph: PlanningGraphQuery = graphRequests > 1
          ? { ...emptyGraph, sprints: { nodes: [createdSprint] } }
          : emptyGraph;
        return graph as TResult;
      }
      if (operation === "CreateSprint") {
        creationVariables = variables;
        return { worktrackerSprintCreateOne: { ...createdSprint, __typename: "WorktrackerSprintBasic" } } as TResult;
      }
      return http.executeGraphQl(document, variables);
    } });
    fireEvent.click(await screen.findByRole("button", { name: "New sprint" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Sprint name" }), { target: { value: "Release" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(graphRequests).toBe(2));
    expect(creationVariables).toEqual({ data: { projectId: "project-1", name: "Release" } });
    expect(screen.getByLabelText("Plan sprint")).toHaveTextContent("list");
    await act(async () => { releaseGraph(); });
    await waitFor(() => expect(screen.getByLabelText("Plan sprint")).toHaveTextContent("created-sprint"));
  });
});
