import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import type { SprintSuggestionRecordFragment } from "../features/sprints/generated/sprints.documents";
import { loadModules, loadProjects } from "../features/projects/queries";
import { usePlanningGraph } from "../features/planning-graph";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";
import { readWorkItem } from "../features/work-items";

const PROJECT = "345113f3-2578-4285-aed7-b86eb7c4fd78";
const EPIC = "9c384685-1d0b-4adf-8a99-60d42a7ee3c6";
const OTHER_EPIC = "7b308285-780a-4a55-b95f-e11a7275ae75";
const STORY = "72d8217b-2fe7-4a7a-894a-f49890afb99e";
const SPRINT = "5e522cda-a3fa-4677-9136-729c31164302";
beforeEach(() => usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true));

function PublicProjectIdentity() {
  const { graph } = usePlanningGraph(PROJECT);
  return <output aria-label="Planning project identity">{graph?.project?.id}</output>;
}

async function planning(proposal = true) {
  const http = fixture();
  http.tree(EPIC, { rootIds: [], children: {}, order: [] });
  http.tree(OTHER_EPIC, { rootIds: [], children: {}, order: [] });
  http.workItems([workItem({ id: STORY, name: "Ship planning", project_id: PROJECT, parent_id: EPIC,
    state: { id: "idea", name: "Implement", group: "backlog", color: null },
    issue_type: { id: "story-type", name: "Story", level: "task", color: null, sort_order: 1 },
  })]);
  let issue = {
    __typename: "WorktrackerIssue" as const, id: STORY, name: "Ship planning", sequenceId: 1, rank: "V",
    parentId: EPIC, moduleId: EPIC, stateId: "idea", stateRevision: 1, sprintId: null as string | null,
    updatedAt: "2026-10-04", issueType: { __typename: "WorktrackerIssuetype" as const, id: "story-type", name: "Story" },
  };
  let suggestion: SprintSuggestionRecordFragment = {
    __typename: "WorktrackerSprintSuggestion", id: "suggestion", sprintId: SPRINT, goalId: "goal",
    issueId: proposal ? null : issue.id, issue: proposal ? null : issue,
    proposedName: proposal ? issue.name : null, proposedEpicId: EPIC, reason: "Fits the release goal",
    status: "waiting", runId: "run", createdAt: "2026-10-04",
  };
  const decisions: unknown[] = [];
  usePlanWorkspace.setState({ active: true, projectId: PROJECT, sprintId: SPRINT });
  mountStudio({ http, children: <><PublicProjectIdentity /><PlanSprintView projectId={PROJECT} sprintId={SPRINT} renderWorkItemDetail={(id) => <p>Selected ticket {id}</p>} /></>,
    graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      switch (documentOperationName(document)) {
        case "PlanningGraph": return {
          project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: PROJECT, name: "Planner", slug: "PLAN" }] },
          states: { __typename: "WorktrackerStateConnection", nodes: [{ __typename: "WorktrackerState", id: "idea", name: "Implement", group: "backlog", color: "", sortOrder: 0 }] },
          issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [{ __typename: "WorktrackerIssuetype", id: "story-type", name: "Story", level: "task" }, { __typename: "WorktrackerIssuetype", id: "epic-type", name: "Epic", level: "module" }] },
          modules: { __typename: "WorktrackerIssueConnection", nodes: [{ __typename: "WorktrackerIssue", id: EPIC, name: "Module 1", sequenceId: 1, presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] } }, { __typename: "WorktrackerIssue", id: OTHER_EPIC, name: "Module 2", sequenceId: 2, presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] } }] },
          sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ __typename: "WorktrackerSprint", id: SPRINT, name: "Release", status: "planned", rank: "V", createdAt: "2026-10-04" }] },
          workItems: { __typename: "WorktrackerIssueConnection", nodes: suggestion.issueId ? [issue] : [] },
        } as TResult;
        case "SprintSuggestions": return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [suggestion] } } as TResult;
        case "SprintSuggestionExecution": return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [] } } as TResult;
        case "UpdateSprintSuggestion": {
          decisions.push(variables);
          const { status } = variables as { status: string };
          issue = { ...issue, sprintId: status === "accepted" ? SPRINT : null };
          suggestion = { ...suggestion, status, ...(status === "accepted" || suggestion.issueId ? { issueId: issue.id, issue, proposedName: null } : {}) };
          return { update_sprint_suggestion: suggestion } as TResult;
        }
        default: return http.executeGraphQl(document, variables);
      }
    },
  });
  await screen.findByTestId("plan-sprint");
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Module 2,/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Module 1,/ }));
  return { decisions };
}

it("[overhaul-526] preserves public UUIDs and open epic visits through collection refresh and proposal accept, Undo, reaccept", async () => {
  const { decisions } = await planning();
  const expectVisit = () => {
    expect(screen.getByRole("tab", { name: /^Module 1,/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^Module 2,/ })).toHaveAttribute("aria-selected", "false");
  };
  expectVisit();
  await act(async () => { await loadProjects(); await loadModules(PROJECT); });
  expect(screen.getByLabelText("Planning project identity")).toHaveTextContent(PROJECT);
  expectVisit();
  // The mounted Studio shell needs the public detail record before selection.
  await act(async () => { await readWorkItem(STORY); });
  fireEvent.click(screen.getByRole("button", { name: "✦ Ship planning" }));
  fireEvent.click(screen.getByRole("button", { name: "Create story" }));
  const undo = await screen.findByRole("button", { name: "Undo Ship planning suggestion" });
  await waitFor(() => expect(undo).toBeEnabled());
  await screen.findByText(`Selected ticket ${STORY}`);
  await act(async () => { await loadModules(PROJECT); });
  expectVisit();
  fireEvent.click(undo);
  await screen.findByRole("button", { name: "Accept Ship planning" });
  await act(async () => { await loadModules(PROJECT); });
  expectVisit();
  expect(await within(screen.getByTestId("plan-backlog")).findByText("Ship planning")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Accept Ship planning" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Undo Ship planning suggestion" })).toBeEnabled());
  await act(async () => { await loadModules(PROJECT); });
  expectVisit();
  expect(await within(screen.getByTestId("plan-sprint-items")).findByText("Ship planning")).toBeVisible();
  expect(decisions).toEqual([{ id: "suggestion", status: "accepted" }, { id: "suggestion", status: "waiting" }, { id: "suggestion", status: "accepted" }]);
});
