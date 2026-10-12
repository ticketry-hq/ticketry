import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { PlanningGraphDocument } from "../features/planning-graph";
import { studioApolloClient } from "../shared/apollo/client";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio } from "./seam";
import { planningProjectOpenFixture } from "./planningProjectOpenFixture";

beforeEach(() => usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true));

async function planning() {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  usePlanWorkspace.setState({ active: true, projectId: "project-1", sprintId: "sprint",
    visits: { sprint: { epicTabs: ["alpha"], activeEpicId: "alpha" } } });
  let epicAvailable = true;
  const graph = () => ({
    project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
    states: { __typename: "WorktrackerStateConnection", nodes: [] },
    issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [{ __typename: "WorktrackerIssuetype", id: "epic-type", name: "Epic", level: "module" }] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: epicAvailable ? [{ __typename: "WorktrackerIssue", id: "alpha", name: "Alpha", sequenceId: 1,
      presentation: { __typename: "WorktrackerModulePresentationConnection", nodes: [] } }] : [] },
    sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ __typename: "WorktrackerSprint", id: "sprint", name: "Release", status: "planned", rank: "V", createdAt: "2026-10-04" }] },
    workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
  });
  mountStudio({ http,
    children: <><textarea aria-label="Unrelated editor" defaultValue="Keep typing" />
      <PlanSprintView projectId="project-1" sprintId="sprint" renderWorkItemDetail={() => null} /></>,
    graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      switch (documentOperationName(document)) {
        case "PlanningGraph": return graph() as TResult;
        case "WorkTrackerProjectOpen": return planningProjectOpenFixture(http, document, variables, graph());
        case "SprintSuggestions": return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [] } } as TResult;
        case "SprintSuggestionExecution": return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [] } } as TResult;
        default: return http.executeGraphQl(document, variables);
      }
    },
  });
  await screen.findByRole("tab", { name: "Alpha, 0 backlog stories" });
  const editor = screen.getByRole("textbox", { name: "Unrelated editor" });
  act(() => editor.focus());
  expect(editor).toHaveFocus();
  return { editor, removeEpic: async () => {
    epicAvailable = false;
    await act(async () => { await studioApolloClient().refetchQueries({ include: [PlanningGraphDocument] }); });
  } };
}

it("[overhaul-834] preserves unrelated editor focus when background graph repair removes the final epic", async () => {
  const { editor, removeEpic } = await planning();
  await removeEpic();
  await waitFor(() => expect(screen.queryByRole("tab", { name: "Alpha, 0 backlog stories" })).not.toBeInTheDocument());
  expect(screen.getByRole("textbox", { name: "Unrelated editor" })).toBe(editor);
  expect(editor).toHaveFocus();
  fireEvent.change(editor, { target: { value: "Keep typing after background repair" } });
  expect(editor).toHaveValue("Keep typing after background repair");
  expect(screen.getByRole("button", { name: "Add epic" })).toBeVisible();
});

it("[overhaul-835] explicit final Close hands focus to Add epic even when an unrelated editor owns focus", async () => {
  await planning();
  fireEvent.click(screen.getByRole("button", { name: "Close Alpha" }));
  expect(screen.queryByRole("tab", { name: "Alpha, 0 backlog stories" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add epic" })).toHaveFocus();
});

it("[overhaul-836] explicit final Done hands focus to Add epic even when an unrelated editor owns focus", async () => {
  await planning();
  fireEvent.click(screen.getByRole("button", { name: "Done with Alpha" }));
  expect(screen.queryByRole("tab", { name: "Alpha, 0 backlog stories" })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Add epic" })).toHaveFocus());
});
