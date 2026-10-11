import { ApolloClient, ApolloLink, InMemoryCache, Observable } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlanningGraphQuery } from "../features/planning-graph/generated/planningGraph.documents";
import type { SprintSuggestionRecordFragment } from "../features/sprints/generated/sprints.documents";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { useStudioStore } from "../features/projects";

function record<T extends object>(__typename: string, fields: T) {
  return { __typename, ...fields };
}

const suggestion = {
  __typename: "WorktrackerSprintSuggestion", id: "suggestion", sprintId: "sprint", goalId: "goal",
  issueId: "story", proposedName: null, proposedEpicId: null, reason: "Fits the release goal",
  status: "waiting", runId: "run", createdAt: "2026-10-04", issue: {
    __typename: "WorktrackerIssue", id: "story", name: "Ship planning", sequenceId: 1, rank: "V",
    parentId: null, moduleId: "epic", stateId: "idea", stateRevision: 1, sprintId: null,
    updatedAt: "2026-10-04", issueType: record("WorktrackerIssuetype", { id: "story-type", name: "Story" }),
  },
} satisfies SprintSuggestionRecordFragment;

describe("Recovered active epic bulk review", () => {
  it("[overhaul-549] adds only the active epic's waiting suggestions and preserves the selected ticket", async () => {
    let suggestions: SprintSuggestionRecordFragment[] = [
      suggestion,
      { ...suggestion, id: "proposal", issue: null, issueId: null, proposedName: "Draft proposal", proposedEpicId: "epic" },
      { ...suggestion, id: "other", issue: { ...suggestion.issue, id: "other-story", name: "Other epic story", moduleId: "other-epic", sequenceId: 2 }, issueId: "other-story" },
      { ...suggestion, id: "dismissed", status: "dismissed", issue: null, issueId: null, proposedName: "Dismissed proposal", proposedEpicId: "epic" },
    ];
    const graph = {
      project: record("WorktrackerProjectConnection", { nodes: [record("WorktrackerProject", { id: "project", name: "Planner", slug: "PLAN" })] }),
      states: record("WorktrackerStateConnection", { nodes: [record("WorktrackerState", { id: "idea", name: "Implement", group: "backlog", color: "", sortOrder: 0 })] }),
      issueTypes: record("WorktrackerIssuetypeConnection", { nodes: [record("WorktrackerIssuetype", { id: "story-type", name: "Story", level: "task" }), record("WorktrackerIssuetype", { id: "epic-type", name: "Epic", level: "module" })] }),
      sprints: record("WorktrackerSprintConnection", { nodes: [record("WorktrackerSprint", { id: "sprint", name: "Release", status: "planned", rank: "V", createdAt: "2026-10-04" })] }),
      modules: record("WorktrackerIssueConnection", { nodes: [
        record("WorktrackerIssue", { id: "epic", name: "Planning", sequenceId: 10, presentation: record("WorktrackerModulePresentationConnection", { nodes: [] }) }),
        record("WorktrackerIssue", { id: "other-epic", name: "Other", sequenceId: 11, presentation: record("WorktrackerModulePresentationConnection", { nodes: [] }) }),
      ] }),
      workItems: record("WorktrackerIssueConnection", { nodes: suggestions.flatMap((row) => row.issue ? [row.issue] : []) }),
    } satisfies PlanningGraphQuery;
    const requests: unknown[] = [];
    let releaseBatch = () => {};
    const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink((operation) => new Observable((observer) => {
      switch (operation.operationName) {
        case "PlanningGraph": observer.next({ data: graph }); break;
        case "SprintSuggestions": observer.next({ data: { worktrackerSprintSuggestion: record("WorktrackerSprintSuggestionConnection", { nodes: suggestions }) } }); break;
        case "SprintSuggestionExecution": observer.next({ data: { worktrackerSprint: record("WorktrackerSprintConnection", { nodes: [record("WorktrackerSprint", {
          id: "sprint", status: "planned", suggestionRunId: null, goalsRevisedAt: null,
          goals: record("WorktrackerSprintGoalConnection", { nodes: [record("WorktrackerSprintGoal", { id: "goal", text: "Release", position: 1 })] }),
          suggestions: record("WorktrackerSprintSuggestionConnection", { nodes: suggestions.filter((row) => row.status === "waiting").map((row) => record("WorktrackerSprintSuggestion", { id: row.id })) }),
        })] }) } }); break;
        case "UpdateSprintSuggestion": {
          const row = suggestions.find((candidate) => candidate.id === operation.variables.id);
          if (!row || operation.variables.status !== "accepted") throw new Error("Unexpected suggestion update");
          requests.push(operation.variables);
          const deliver = () => {
            const issue = row.issue ?? { ...suggestion.issue, id: "created-story", name: row.proposedName ?? "Draft proposal", sequenceId: 3 };
            const accepted = { ...row, status: "accepted", issueId: issue.id, issue: { ...issue, sprintId: "sprint" } };
            suggestions = suggestions.map((candidate) => candidate.id === row.id ? accepted : candidate);
            graph.workItems.nodes = [...graph.workItems.nodes.filter((item) => item.id !== issue.id), accepted.issue];
            observer.next({ data: { update_sprint_suggestion: accepted } });
            observer.complete();
          };
          if (requests.length === 1) releaseBatch = deliver;
          else deliver();
          return;
        }
        default: throw new Error(`Unexpected operation ${operation.operationName}`);
      }
      observer.complete();
    })) });
    useStudioStore.setState({ selectedProjectId: "project" });
    usePlanWorkspace.setState({ active: true, projectId: "project", sprintId: "sprint", openItem: "unrelated",
      visits: { sprint: { epicTabs: ["epic", "other-epic"], activeEpicId: "epic" } } });
    const view = render(<ApolloProvider client={client}><PlanSprintView projectId="project" sprintId="sprint"
      renderWorkItemDetail={(id) => <p>Selected ticket {id}</p>} /></ApolloProvider>);
    try {
      const backlog = within(await screen.findByTestId("plan-backlog"));
      const planned = within(screen.getByTestId("plan-sprint-items"));
      expect(await backlog.findByRole("button", { name: "✦ Ship planning" })).toBeVisible();
      expect(backlog.getByRole("button", { name: "✦ Draft proposal" })).toBeVisible();
      expect(backlog.queryByText("Other epic story")).not.toBeInTheDocument();
      expect(backlog.queryByText("Dismissed proposal")).not.toBeInTheDocument();
      fireEvent.click(backlog.getByRole("button", { name: "Add all" }));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(backlog.getByRole("button", { name: "Add all" })).toBeDisabled();
      fireEvent.click(backlog.getByRole("button", { name: "Add all" }));
      fireEvent.click(screen.getByRole("tab", { name: "Other, 1 backlog stories, 1 waiting suggestions" }));
      expect(backlog.getByRole("button", { name: "Add all" })).toBeDisabled();
      fireEvent.click(backlog.getByRole("button", { name: "Add all" }));
      await act(async () => { releaseBatch(); });
      await waitFor(() => expect(planned.getByText("Draft proposal")).toBeVisible());
      expect(planned.getByText("Ship planning")).toBeVisible();
      expect(planned.queryByText("Other epic story")).not.toBeInTheDocument();
      expect(requests).toEqual([{ id: "suggestion", status: "accepted" }, { id: "proposal", status: "accepted" }]);
      expect(screen.getByText("Selected ticket unrelated")).toBeVisible();
      expect(screen.getAllByText("✦ 1 to review")).toHaveLength(2);
      expect(backlog.getByRole("button", { name: "✦ Other epic story" })).toBeVisible();
      await waitFor(() => expect(backlog.getByRole("button", { name: "Add all" })).toBeEnabled());
      fireEvent.click(screen.getByRole("tab", { name: "Planning, 0 backlog stories" }));
      expect(backlog.queryByRole("button", { name: "Add all" })).not.toBeInTheDocument();
    } finally { view.unmount(); client.stop(); }
  });

});
