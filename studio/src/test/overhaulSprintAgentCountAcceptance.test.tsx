import { useState } from "react";
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SuggestionAgentBox, useUpdateSprintSuggestion } from "../features/sprints";
import type { SprintSuggestionRecordFragment } from "../features/sprints/generated/sprints.documents";

function ReviewControls() {
  const { update } = useUpdateSprintSuggestion({ projectId: "project", sprintId: "sprint" });
  const [message, setMessage] = useState("Ready");
  const change = (status: string) => {
    setMessage("Saving");
    void update({ id: "suggestion-1", status }).then(() => setMessage("Saved"));
  };
  return <>
    <button onClick={() => change("dismissed")}>Dismiss suggestion</button>
    <button onClick={() => change("waiting")}>Undo dismissal</button>
    <output aria-label="Suggestion save status">{message}</output>
  </>;
}

function fixture() {
  const suggestions: SprintSuggestionRecordFragment[] = [1, 2].map((index) => ({
    __typename: "WorktrackerSprintSuggestion", id: `suggestion-${index}`, sprintId: "sprint",
    goalId: "goal", issueId: null, proposedName: `Story ${index}`, proposedEpicId: "epic",
    reason: "Fits the goal", status: "waiting", runId: "run", createdAt: "2026-10-04T00:00:00Z", issue: null,
  }));
  let holdCard = false;
  let cardPending = false;
  let releaseCard = () => {};
  const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink((operation) =>
    new Observable((observer) => {
      const deliver = (data: Record<string, unknown>) => { observer.next({ data }); observer.complete(); };
      switch (operation.operationName) {
        case "SprintSuggestionExecution": {
          const publish = () => deliver({ worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [{
            __typename: "WorktrackerSprint", id: "sprint", status: "planned", suggestionRunId: "run",
            goalsRevisedAt: "2026-10-04T00:00:00Z",
            goals: { __typename: "WorktrackerSprintGoalConnection", nodes: [{ __typename: "WorktrackerSprintGoal", id: "goal", text: "Ship planning" }] },
            suggestions: { __typename: "WorktrackerSprintSuggestionConnection", nodes: suggestions.filter((row) => row.status === "waiting").map(({ id }) => ({ __typename: "WorktrackerSprintSuggestion", id })) },
          }] } });
          if (holdCard) { cardPending = true; releaseCard = publish; }
          else publish();
          return;
        }
        case "SprintSuggestionExecutionRun":
          deliver({ agentExecutions: { __typename: "AgentExecutionsConnection", nodes: [{
            __typename: "AgentExecutions", id: "execution", agentRunId: "run", sprintId: "sprint",
            outputType: "sprint_suggestions_v1", state: "succeeded", error: null, cancelRequested: false,
            goalsRevision: "2026-10-04T00:00:00Z", createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z",
          }] } });
          return;
        case "UpdateSprintSuggestion": {
          const row = suggestions.find((row) => row.id === operation.variables.id);
          if (!row) { observer.error(new Error("Suggestion missing")); return; }
          row.status = operation.variables.status;
          deliver({ update_sprint_suggestion: { ...row } });
          return;
        }
        case "SprintSuggestions":
          deliver({ worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: suggestions.map((row) => ({ ...row })) } });
          return;
        case "PlanningGraph":
          deliver({ project: { __typename: "WorktrackerProjectConnection", nodes: [] },
            states: { __typename: "WorktrackerStateConnection", nodes: [] },
            issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] },
            sprints: { __typename: "WorktrackerSprintConnection", nodes: [] },
            modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
            workItems: { __typename: "WorktrackerIssueConnection", nodes: [] } });
          return;
        default: observer.error(new Error(`Unexpected operation ${operation.operationName}`));
      }
    })),
  });
  return { client, hold: () => { holdCard = true; cardPending = false; },
    pending: () => cardPending, release: () => { holdCard = false; releaseCard(); } };
}

describe("sprint card suggestion count", () => {
  it("[overhaul-433] refreshes the ready count after dismissal and Undo before saving settles", async () => {
    const server = fixture();
    const view = render(<ApolloProvider client={server.client}>
      <SuggestionAgentBox projectId="project" sprintId="sprint" /><ReviewControls />
    </ApolloProvider>);
    try {
      expect(await screen.findByText(/2 suggestions ready/)).toBeVisible();
      for (const [button, expected] of [["Dismiss suggestion", "1 suggestions ready"], ["Undo dismissal", "2 suggestions ready"]]) {
        server.hold();
        fireEvent.click(screen.getByRole("button", { name: button }));
        await waitFor(() => expect(server.pending()).toBe(true));
        expect(screen.getByLabelText("Suggestion save status")).toHaveTextContent("Saving");
        await act(async () => server.release());
        expect(await screen.findByText(new RegExp(expected))).toBeVisible();
        await waitFor(() => expect(screen.getByLabelText("Suggestion save status")).toHaveTextContent("Saved"));
      }
    } finally {
      view.unmount();
      server.client.stop();
    }
  });

  it("restores the authoritative count when reopening a cached card after dismissal and Undo", async () => {
    const server = fixture();
    const content = (showCard: boolean) => <ApolloProvider client={server.client}>
      {showCard && <SuggestionAgentBox projectId="project" sprintId="sprint" />}
      <ReviewControls />
    </ApolloProvider>;
    const view = render(content(true));
    try {
      expect(await screen.findByText(/2 suggestions ready/)).toBeVisible();
      for (const [button, expected] of [["Dismiss suggestion", "1 suggestions ready"], ["Undo dismissal", "2 suggestions ready"]]) {
        view.rerender(content(false));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        fireEvent.click(screen.getByRole("button", { name: button }));
        await waitFor(() => expect(screen.getByLabelText("Suggestion save status")).toHaveTextContent("Saved"));
        server.hold();
        view.rerender(content(true));
        expect(await screen.findByText(new RegExp(expected))).toBeVisible();
        await act(async () => server.release());
      }
    } finally {
      view.unmount();
      server.client.stop();
    }
  });
});
