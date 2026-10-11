import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import type { SprintSuggestionRecordFragment } from "../features/sprints/generated/sprints.documents";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";
import { planningProjectOpenFixture } from "./planningProjectOpenFixture";

beforeEach(() => usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true));

async function planning(proposal = false) {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  http.workItems([workItem({ id: "story", name: "Ship planning", parent_id: null })]);
  let issue = {
    __typename: "WorktrackerIssue" as const, id: "story", name: "Ship planning", sequenceId: 1, rank: "V",
    parentId: null, moduleId: null, stateId: "idea", stateRevision: 1, sprintId: null as string | null,
    updatedAt: "2026-10-04", issueType: { __typename: "WorktrackerIssuetype" as const, id: "story-type", name: "Story" },
  };
  let suggestion: SprintSuggestionRecordFragment = {
    __typename: "WorktrackerSprintSuggestion", id: "suggestion", sprintId: "sprint", goalId: "goal",
    issueId: proposal ? null : issue.id, issue: proposal ? null : issue,
    proposedName: proposal ? issue.name : null, proposedEpicId: null, reason: "Fits the release goal",
    status: "waiting", runId: "run", createdAt: "2026-10-04",
  };
  const decisions: unknown[] = [];
  usePlanWorkspace.setState({ active: true, projectId: "project-1", sprintId: "sprint" });
  const graph = () => ({
    project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
    states: { __typename: "WorktrackerStateConnection", nodes: [{ __typename: "WorktrackerState", id: "idea", name: "Implement", group: "backlog", color: "", sortOrder: 0 }] },
    issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [{ __typename: "WorktrackerIssuetype", id: "story-type", name: "Story", level: "task" }, { __typename: "WorktrackerIssuetype", id: "epic-type", name: "Epic", level: "module" }] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
    sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ __typename: "WorktrackerSprint", id: "sprint", name: "Release", status: "planned", rank: "V", createdAt: "2026-10-04" }] },
    workItems: { __typename: "WorktrackerIssueConnection", nodes: suggestion.issueId ? [issue] : [] },
  });
  mountStudio({ http, children: <PlanSprintView projectId="project-1" sprintId="sprint" renderWorkItemDetail={(id) => <p>Selected ticket {id}</p>} />,
    graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      switch (documentOperationName(document)) {
        case "PlanningGraph": return graph() as TResult;
        case "WorkTrackerProjectOpen": return planningProjectOpenFixture(http, document, variables, graph());
        case "SprintSuggestions": return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [suggestion] } } as TResult;
        case "SprintSuggestionExecution": return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [] } } as TResult;
        case "UpdateSprintSuggestion": {
          decisions.push(variables);
          const { status } = variables as { status: string };
          issue = { ...issue, sprintId: status === "accepted" ? "sprint" : null };
          suggestion = { ...suggestion, status, ...(status === "accepted" || suggestion.issueId ? { issueId: issue.id, issue, proposedName: null } : {}) };
          return { update_sprint_suggestion: suggestion } as TResult;
        }
        default: return http.executeGraphQl(document, variables);
      }
    },
  });
  await screen.findByTestId("plan-sprint");
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(await screen.findByRole("button", { name: /^No epic,/ }));
  return { decisions };
}

it("[overhaul-524] accepting an existing suggestion offers Undo and returns the Story to the Backlog", async () => {
  const { decisions } = await planning();
  fireEvent.click(screen.getByRole("button", { name: "Accept Ship planning" }));
  const undo = await screen.findByRole("button", { name: /^Undo / });
  await waitFor(() => expect(undo).toBeEnabled());
  fireEvent.click(undo);
  expect(await screen.findByRole("button", { name: "Accept Ship planning" })).toBeEnabled();
  await waitFor(() => expect(within(screen.getByTestId("plan-sprint-items")).queryByText("Ship planning")).not.toBeInTheDocument());
  expect(await within(screen.getByTestId("plan-backlog")).findByText("Ship planning")).toBeVisible();
  expect(decisions).toEqual([{ id: "suggestion", status: "accepted" }, { id: "suggestion", status: "waiting" }]);
});

it("[overhaul-511] dismissing a suggestion offers Undo and restores its waiting row", async () => {
  const { decisions } = await planning();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss Ship planning" }));
  const undo = await screen.findByRole("button", { name: "Undo Ship planning suggestion" });
  await waitFor(() => expect(undo).toBeEnabled());
  fireEvent.click(undo);
  expect(await screen.findByRole("button", { name: "Dismiss Ship planning" })).toBeEnabled();
  expect(decisions).toEqual([{ id: "suggestion", status: "dismissed" }, { id: "suggestion", status: "waiting" }]);
});

it("[overhaul-512] proposal acceptance Undo retains the created Story in the Backlog and restores an existing-story suggestion", async () => {
  const { decisions } = await planning(true);
  fireEvent.click(screen.getByRole("button", { name: "✦ Ship planning" }));
  fireEvent.click(screen.getByRole("button", { name: "Create story" }));
  const undo = await screen.findByRole("button", { name: "Undo Ship planning suggestion" });
  await waitFor(() => expect(undo).toBeEnabled());
  fireEvent.click(undo);
  expect(await screen.findByRole("button", { name: "Accept Ship planning" })).toHaveTextContent("✓ Add");
  expect(await within(screen.getByTestId("plan-backlog")).findByText("Ship planning")).toBeVisible();
  expect(within(screen.getByTestId("plan-sprint-items")).queryByText("Ship planning")).not.toBeInTheDocument();
  expect(decisions).toEqual([{ id: "suggestion", status: "accepted" }, { id: "suggestion", status: "waiting" }]);
});
