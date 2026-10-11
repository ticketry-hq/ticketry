import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio } from "./seam";
import { planningProjectOpenFixture } from "./planningProjectOpenFixture";

beforeEach(() => usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true));

async function planning() {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  usePlanWorkspace.setState({ active: true, projectId: "project-1", sprintId: "sprint",
    visits: { sprint: { epicTabs: ["alpha", "beta", "gamma"], activeEpicId: "beta" } } });
  const graph = () => ({
    project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
    states: { __typename: "WorktrackerStateConnection", nodes: [] },
    issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [{ __typename: "WorktrackerIssuetype", id: "epic-type", name: "Epic", level: "module" }] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: ["Alpha", "Beta", "Gamma"].map((name) => ({
      __typename: "WorktrackerIssue", id: name.toLowerCase(), name, sequenceId: 1,
      presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] },
    })) },
    sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ __typename: "WorktrackerSprint", id: "sprint", name: "Release", status: "planned", rank: "V", createdAt: "2026-10-04" }] },
    workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
  });
  const view = mountStudio({ http,
    children: <PlanSprintView projectId="project-1" sprintId="sprint" renderWorkItemDetail={() => null} />,
    graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      switch (documentOperationName(document)) {
        case "PlanningGraph": return graph() as TResult;
        case "WorkTrackerProjectOpen": return planningProjectOpenFixture(http, document, variables, graph());
        case "SprintSuggestions": return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [{
          __typename: "WorktrackerSprintSuggestion", id: "suggestion", sprintId: "sprint", goalId: "goal",
          issueId: null, issue: null, proposedName: "Plan Beta", proposedEpicId: "beta", reason: "Release goal",
          status: "waiting", runId: "run", createdAt: "2026-10-04",
        }] } } as TResult;
        case "SprintSuggestionExecution": return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [] } } as TResult;
        default: return http.executeGraphQl(document, variables);
      }
    },
  });
  await screen.findByRole("tab", { name: "Beta, 0 backlog stories, 1 waiting suggestions" });
  return view;
}

async function settled() {
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}

it("[overhaul-525] Done with epic restores neighbor focus for roving keys and preserves waiting suggestions", async () => {
  await planning();
  const done = screen.getByRole("button", { name: "Done with Beta → next" });
  done.focus();
  fireEvent.click(done);
  await settled();
  const gamma = screen.getByRole("tab", { name: "Gamma, 0 backlog stories" });
  expect(gamma).toHaveAttribute("aria-selected", "true");
  expect(gamma).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  const alpha = screen.getByRole("tab", { name: "Alpha, 0 backlog stories" });
  expect(alpha).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(gamma).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(alpha).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Beta, 0 backlog stories, 1 waiting suggestions" }));
  expect(await within(screen.getByTestId("plan-backlog")).findByRole("button", { name: "✦ Plan Beta" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Beta, 0 backlog stories, 1 waiting suggestions" })).toHaveAttribute("aria-selected", "true");
  for (const name of ["Beta", "Gamma", "Alpha"]) {
    const finish = screen.getByRole("button", { name: new RegExp(`^Done with ${name}`) });
    finish.focus();
    fireEvent.click(finish);
    await settled();
  }
  const addEpic = screen.getByRole("button", { name: "Add epic" });
  expect(addEpic).toHaveFocus();
  fireEvent.click(addEpic);
  expect(screen.getByRole("button", { name: "Beta, 0 backlog stories, 1 waiting suggestions" })).toBeVisible();
});
