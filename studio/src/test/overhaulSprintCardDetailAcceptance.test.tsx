import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import IssueDetail from "../app/shell/ticket-workspace/selected-ticket/details/IssueDetail";
import { SprintsWorkspace, openPlanWorkspace, usePlanWorkspace } from "../features/sprints";
import { closePlanSprint } from "../features/sprints/planWorkspaceState";
import { getStorySprintFilterIntent, setStorySprintFilterIntent } from "../features/work-items";
import { useClientStore } from "../state/clientStore";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";

const PROJECT = "345113f3-2578-4285-aed7-b86eb7c4fd78";
const EPIC = "9c384685-1d0b-4adf-8a99-60d42a7ee3c6";
const STORY = "72d8217b-2fe7-4a7a-894a-f49890afb99e";
const SPRINT = "5e522cda-a3fa-4677-9136-729c31164302";
const OTHER_SPRINT = "a4b934af-4f48-4dc8-b4c4-97bfb51cda56";

it("[overhaul-584] a sprint card opens canonical public-UUID Story details outside the selected module and sprint filter", async () => {
  const http = fixture();
  http.tree(EPIC, { rootIds: [], children: {}, order: [] });
  http.storySprints([
    { id: SPRINT, projectId: PROJECT, name: "Lifecycle current", status: "planned" },
    { id: OTHER_SPRINT, projectId: PROJECT, name: "Restricted selection", status: "planned" },
  ]);
  http.workItems([workItem({ id: STORY, project_id: PROJECT, name: "Lifecycle done", parent_id: null,
    sprint_id: SPRINT, state: { id: "done", name: "Done", group: "completed", color: "#999" },
    issue_type: { id: "story-type", name: "Story", level: "task", color: "", sort_order: 0 },
  })]);
  const reads: string[] = [];
  const graph = {
    project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: PROJECT, name: "Project", slug: "PLAN" }] },
    states: { __typename: "WorktrackerStateConnection", nodes: [{ __typename: "WorktrackerState", id: "done", name: "Done", group: "completed", color: "#999", sortOrder: 0 }] },
    issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [{ __typename: "WorktrackerIssuetype", id: "story-type", name: "Story", level: "task" }] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: [{ __typename: "WorktrackerIssue", id: EPIC, name: "Epic", sequenceId: 1,
      presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] } }] },
    sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ __typename: "WorktrackerSprint", id: SPRINT, name: "Lifecycle current", status: "planned", rank: "V", createdAt: "2026-10-08" }] },
    workItems: { __typename: "WorktrackerIssueConnection", nodes: [{ __typename: "WorktrackerIssue", id: STORY, name: "Lifecycle done", sequenceId: 9,
      rank: "V", parentId: null, moduleId: null, stateId: "done", stateRevision: 1, sprintId: SPRINT, updatedAt: "2026-10-08",
      issueType: { __typename: "WorktrackerIssuetype", id: "story-type", name: "Story" } }] },
  };
  usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true);
  mountStudio({ http, children: <SprintsWorkspace
    renderWorkItemDetail={(id) => <IssueDetail issueId={id} detailsVisible />}
    renderSprintGoals={() => null} renderSuggestionAgentBox={() => null} />,
    graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      const operation = documentOperationName(document);
      if (operation === "PlanningGraph") return graph as TResult;
      if (operation === "WorkTrackerWorkItem") reads.push((variables as { id: string }).id);
      return http.executeGraphQl(document, variables);
    },
  });
  act(() => {
    setStorySprintFilterIntent(PROJECT, { mode: "id", sprintId: OTHER_SPRINT });
    openPlanWorkspace();
    closePlanSprint();
  });
  const card = within(await screen.findByTestId(`sprint-card-${SPRINT}`));
  const row = await card.findByRole("button", { name: /Lifecycle done/ });
  fireEvent.click(row);
  await waitFor(() => expect(row).toHaveAttribute("aria-pressed", "true"));
  const detail = within(await screen.findByRole("complementary", { name: "Selected ticket" }));
  expect(await detail.findByTestId("issue-name")).toHaveTextContent("Lifecycle done");
  expect(reads).toContain(STORY.replace(/-/g, ""));
  expect(useClientStore.getState().selectedTaskId).toBe(STORY);
  expect(getStorySprintFilterIntent(PROJECT)).toEqual({ mode: "id", sprintId: OTHER_SPRINT });
  fireEvent.click(detail.getByRole("button", { name: "Close selected ticket" }));
  expect(screen.queryByRole("complementary", { name: "Selected ticket" })).not.toBeInTheDocument();
  expect(screen.getByTestId(`sprint-card-${SPRINT}`)).toBeVisible();
});
