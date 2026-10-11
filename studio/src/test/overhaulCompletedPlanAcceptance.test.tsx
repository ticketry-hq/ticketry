import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { createWorkItemInvalidator } from "../features/agents/status/stream/workItemInvalidation";
import { readStatusFact } from "../features/agents/status/stream/statusFacts";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";
import { planningProjectOpenFixture } from "./planningProjectOpenFixture";

it("[overhaul-529] a completion membership fact closes incoming controls and Undo while retained work can return", async () => {
  const http = fixture();
  const assignments = new Map<string, string | null>([["incoming", null], ["outgoing", "sprint"], ["retained", "sprint"]]);
  http.tree("module-1", { rootIds: [...assignments.keys()], children: {}, order: [...assignments.keys()] });
  http.workItems([...assignments].map(([id, sprint_id], index) => workItem({ id, name: id, key: `T-${index + 2}`, parent_id: null, sequence_id: index + 2, sprint_id, state: { id: id === "retained" ? "done" : "idea", name: id === "retained" ? "Done" : "Implement", group: id === "retained" ? "completed" : "started", color: "" } })));
  const writes: Array<{ id: string; sprintId: string | null }> = [];
  let status = "active";
  let graphReads = 0;
  const graph = () => ({
    project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "T" }] },
    states: { __typename: "WorktrackerStateConnection", nodes: [
      { __typename: "WorktrackerState", id: "idea", name: "Implement", group: "started", color: "", sortOrder: 0 },
      { __typename: "WorktrackerState", id: "done", name: "Done", group: "completed", color: "", sortOrder: 1 },
    ] },
    issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [
      { __typename: "WorktrackerIssuetype", id: "story-type", name: "Story", level: "task" },
      { __typename: "WorktrackerIssuetype", id: "epic-type", name: "Epic", level: "module" },
    ] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: [{ __typename: "WorktrackerIssue", id: "module-1", name: "Epic", sequenceId: 1,
      presentation: { __typename: "WorktrackerModulePresentationConnection", nodes: [] } }] },
    sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ __typename: "WorktrackerSprint", id: "sprint", name: "Release", status, rank: "V", createdAt: "2026-10-04" }] },
    workItems: { __typename: "WorktrackerIssueConnection", nodes: [...assignments].map(([id, sprintId], index) => ({
      __typename: "WorktrackerIssue", id, name: id, sequenceId: index + 2, rank: String(index), parentId: null, moduleId: "module-1",
      stateId: id === "retained" ? "done" : "idea", stateRevision: 1, sprintId, updatedAt: "2026-10-04",
      issueType: { __typename: "WorktrackerIssuetype", id: "story-type", name: "Story" },
    })) },
  });
  usePlanWorkspace.setState({ ...usePlanWorkspace.getInitialState(), active: true, projectId: "project-1", sprintId: "sprint",
    visits: { sprint: { epicTabs: ["module-1"], activeEpicId: "module-1" } } }, true);
  mountStudio({ http, children: <PlanSprintView projectId="project-1" sprintId="sprint" renderWorkItemDetail={() => null} />,
    graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      switch (documentOperationName(document)) {
        case "PlanningGraph": graphReads++; return graph() as TResult;
        case "WorkTrackerProjectOpen": return planningProjectOpenFixture(http, document, variables, graph());
        case "SprintSuggestions": return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [{
          __typename: "WorktrackerSprintSuggestion", id: "suggestion", sprintId: "sprint", goalId: "goal", issueId: null, issue: null,
          proposedName: "Proposal", proposedEpicId: "module-1", reason: "Supports Release", status: "waiting", runId: "run", createdAt: "2026-10-04",
        }] } } as TResult;
        case "SprintSuggestionExecution": return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [] } } as TResult;
        case "PlanWorkItem": {
          const write = variables as { id: string; sprintId: string | null };
          writes.push(write); assignments.set(write.id, write.sprintId);
          return http.executeGraphQl(document, variables);
        }
        default: return http.executeGraphQl(document, variables);
      }
    },
  });
  const backlog = within(await screen.findByTestId("plan-backlog"));
  expect(backlog.getByRole("button", { name: "Plan T-2 into sprint" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Return T-3 to backlog" }));
  await waitFor(() => expect(screen.getByTestId("plan-undo")).toBeEnabled());
  status = "completed";
  const before = graphReads;
  const invalidator = createWorkItemInvalidator();
  try {
    const changed = readStatusFact({
      __typename: "RunStatusEvent", cursor: 1, event_id: "completion-carryover", project_id: "project-1",
      event_kind: "work_item.changed", payload_version: 1, subject_kind: "work_item", subject_id: "outgoing",
      agent_run_id: null, automation_attempt_id: null, work_item_id: "outgoing", committed_at: "2026-10-04T00:00:00Z",
      payload: { workItemId: "outgoing", projectId: "project-1", moduleId: "module-1", changeKind: "updated", membershipChanged: true },
    });
    if (changed?.family !== "work_item") throw new Error("Unreadable sprint-membership wire fact");
    act(() => {
      invalidator.record(changed);
      invalidator.flush();
    });
    await waitFor(() => expect(backlog.getByRole("button", { name: "Plan T-2 into sprint" })).toBeDisabled());
    expect(graphReads).toBeGreaterThan(before);
    expect(screen.getByTestId("plan-undo")).toBeDisabled();
    expect(screen.getByTestId("plan-undo-hint")).toHaveTextContent(/^This sprint is completed and closed to new work\.$/);
    const row = screen.getByTestId("plan-item-T-2");
    expect(row).toHaveAttribute("draggable", "false");
    fireEvent.keyDown(row, { altKey: true, key: "ArrowDown" });
    fireEvent.drop(screen.getByTestId("plan-sprint-items"), {
      dataTransfer: { types: ["application/x-ticketry-story"], getData: () => "incoming" },
    });
    fireEvent.click(backlog.getByRole("button", { name: "Accept Proposal" }));
    expect(backlog.getByRole("button", { name: "Accept Proposal" })).toBeDisabled();
    fireEvent.click(backlog.getByRole("button", { name: "✦ Proposal" }));
    expect(screen.getByRole("button", { name: "Create story" })).toBeDisabled();
    expect(writes).toEqual([{ id: "outgoing", sprintId: null }]);
    const retained = screen.getByRole("button", { name: "Return T-4 to backlog" });
    expect(retained).toBeEnabled();
    fireEvent.click(retained);
    await waitFor(() => expect(writes).toEqual([{ id: "outgoing", sprintId: null }, { id: "retained", sprintId: null }]));
  } finally { invalidator.cancel(); }
});
