import type { ReactNode } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { PlanningGraphDocument } from "../features/planning-graph";
import type { PlanningGraphQuery } from "../features/planning-graph/generated/planningGraph.documents";
import { studioApolloClient } from "../shared/apollo/client";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";

export function mountMovePlan(options: { assignment?: string | null; move?: (write: { id: string; sprintId: string | null }) => Promise<void>; graphRead?: () => Promise<void>; extraControls?: ReactNode; extraStories?: Array<{ id: string; name: string; assignment?: string | null }> } = {}) {
  const http = fixture();
  const storyIds = ["story", ...(options.extraStories ?? []).map((item) => item.id)];
  http.tree("alpha", { rootIds: storyIds, children: {}, order: storyIds });
  http.tree("beta", { rootIds: [], children: {}, order: [] });
  http.workItems([workItem({ id: "story", name: "Delivery", sequence_id: 1, parent_id: null, sprint_id: options.assignment ?? null,
    state: { id: "implement", name: "Implement", group: "started", color: "" } })]);
  let graph: PlanningGraphQuery = {
    project: { nodes: [{ id: "project-1", name: "Planner", slug: "PLAN" }] },
    states: { nodes: [
      { id: "implement", name: "Implement", group: "started", color: "", sortOrder: 0 },
      { id: "done", name: "Done", group: "completed", color: "", sortOrder: 1 },
    ] },
    issueTypes: { nodes: [{ id: "story", name: "Story", level: "task" }, { id: "epic", name: "Epic", level: "module" }] },
    modules: { nodes: ["alpha", "beta"].map((id, index) => ({ id, name: id === "alpha" ? "Alpha" : "Beta", sequenceId: index + 2, presentation: { nodes: [] } })) },
    sprints: { nodes: ["sprint", "second"].map((id) => ({ id, name: id === "sprint" ? "Release" : "Second", status: "active", rank: "V", createdAt: "2026-10-04" })) },
    workItems: { nodes: [{ id: "story", name: "Delivery", sequenceId: 1, rank: "V", parentId: null, moduleId: "alpha", stateId: "implement", stateRevision: 1,
      sprintId: options.assignment ?? null, updatedAt: "2026-10-04", issueType: { id: "story", name: "Story" } }] },
  };
  for (const [index, story] of (options.extraStories ?? []).entries()) {
    http.workItems([workItem({ id: story.id, name: story.name, sequence_id: index + 2, parent_id: null, sprint_id: story.assignment ?? null,
      state: { id: "implement", name: "Implement", group: "started", color: "" } })]);
    graph.workItems.nodes.push({ ...graph.workItems.nodes[0], id: story.id, name: story.name, sequenceId: index + 2, sprintId: story.assignment ?? null });
  }
  // Match the generated query's cache identity contract at the GraphQL boundary.
  const typed = (value: unknown, name: string): unknown => {
    if (!value || typeof value !== "object") return value;
    const row = value as Record<string, unknown>;
    const childNames: Record<string, string> = { project: "WorktrackerProjectConnection", states: "WorktrackerStateConnection", issueTypes: "WorktrackerIssuetypeConnection",
      modules: "WorktrackerIssueConnection", sprints: "WorktrackerSprintConnection", workItems: "WorktrackerIssueConnection", presentation: "WorktrackerModulePresentationConnection", issueType: "WorktrackerIssuetype" };
    const nodeName = name.replace(/Connection$/, "");
    return { ...row, ...(name ? { __typename: name } : {}), ...Object.fromEntries(Object.entries(row).map(([key, val]) => [key,
      key === "nodes" && Array.isArray(val) ? val.map((node) => typed(node, nodeName)) : childNames[key] ? typed(val, childNames[key]) : val])) };
  };
  graph = typed(graph, "") as PlanningGraphQuery;
  const writes: Array<{ id: string; sprintId: string | null }> = [];
  usePlanWorkspace.setState({ ...usePlanWorkspace.getInitialState(), active: true, projectId: "project-1", sprintId: "sprint",
    visits: { sprint: { epicTabs: ["alpha", "beta"], activeEpicId: "alpha" } } }, true);
  mountStudio({ http, children: <><PlanSprintView projectId="project-1" sprintId="sprint" renderWorkItemDetail={() => null} />{options.extraControls}</>,
    graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      switch (documentOperationName(document)) {
        case "PlanningGraph": await options.graphRead?.(); return graph as TResult;
        case "SprintSuggestions": return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [] } } as TResult;
        case "SprintSuggestionExecution": return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [] } } as TResult;
        case "PlanWorkItem": {
          const write = variables as { id: string; sprintId: string | null };
          writes.push(write);
          await options.move?.(write);
          graph = { ...graph, workItems: { ...graph.workItems, nodes: graph.workItems.nodes.map((item) => item.id === write.id ? { ...item, sprintId: write.sprintId } : item) } };
          return http.executeGraphQl(document, variables);
        }
        default: return http.executeGraphQl(document, variables);
      }
    } });
  return { writes, http, change: (edit: (current: PlanningGraphQuery) => PlanningGraphQuery) => {
    graph = edit(graph);
    studioApolloClient().writeQuery({ query: PlanningGraphDocument, variables: { projectId: "project-1" }, data: graph });
  } };
}

/** Change authoritative cache/intent during input, before React renders the new projection. */
export function clickWithCurrentChange(button: HTMLElement, change: () => void) {
  button.addEventListener("click", change, { capture: true, once: true });
  fireEvent.click(button);
}

export function focusBeta() {
  const current = usePlanWorkspace.getState();
  usePlanWorkspace.setState({ visits: { ...current.visits, sprint: { epicTabs: ["alpha", "beta"], activeEpicId: "beta" } } });
}

export async function incomingButton() {
  await screen.findByTestId("plan-sprint");
  return screen.findByRole("button", { name: /Plan .+-1 into sprint/ });
}
export async function flushInput() { await act(async () => { await Promise.resolve(); }); }
