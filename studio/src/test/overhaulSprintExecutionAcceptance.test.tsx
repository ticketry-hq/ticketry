import { ApolloClient, ApolloLink, InMemoryCache, Observable } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SuggestionAgentBox } from "../features/sprints/suggestions/SuggestionAgentBox";
import { useTerminalStore } from "../features/agents/terminal";
import { useClientStore } from "../state/clientStore";
import type { SprintExecutionRecordFragment } from "../features/sprints/generated/sprints.documents";

function fixture() {
  let execution: SprintExecutionRecordFragment | null = null;
  let revision = "2026-10-04T10:00:00";
  let goals = [{ __typename: "WorktrackerSprintGoal", id: "goal", text: "Ship planning" }];
  let ready = 0;
  const operations: string[] = [];
  const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink((operation) =>
    new Observable((observer) => {
      operations.push(operation.operationName ?? "Anonymous");
      if (operation.operationName === "CreateSprintSuggestionExecution") {
        execution = { __typename: "AgentExecutions", id: "execution", agentRunId: "run", sprintId: "sprint",
          outputType: "sprint_suggestions_v1", state: "running", error: null, cancelRequested: false,
          goalsRevision: revision, createdAt: revision, updatedAt: revision };
        observer.next({ data: { agent_execution_create: execution } });
      } else if (operation.operationName === "CancelSprintSuggestionExecution") {
        if (execution) execution = { ...execution, state: "cancelled", cancelRequested: true };
        observer.next({ data: { agent_execution_update: execution } });
      } else if (operation.operationName === "SprintSuggestionExecution") {
        const data = { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [{
          __typename: "WorktrackerSprint", id: "sprint", status: "planned", goalsRevisedAt: revision, suggestionRunId: execution?.agentRunId ?? null,
          goals: { __typename: "WorktrackerSprintGoalConnection", nodes: goals },
          suggestions: { __typename: "WorktrackerSprintSuggestionConnection", nodes: Array.from({ length: ready }, (_, index) => ({ __typename: "WorktrackerSprintSuggestion", id: `suggestion-${index}` })) },
        }] } };
        observer.next({ data });
      } else if (operation.operationName === "SprintSuggestionExecutionRun") {
        observer.next({ data: { agentExecutions: { __typename: "AgentExecutionsConnection", nodes: execution ? [execution] : [] } } });
      } else { observer.error(new Error(`Unexpected operation: ${operation.operationName}`)); return; }
      observer.complete();
    })),
  });
  return { client, operations,
    settle: async (state: string, error: string | null = null) => {
      if (execution) execution = { ...execution, state, error };
      ready = state === "succeeded" ? 2 : 0;
      await client.refetchQueries({ include: ["SprintSuggestionExecution", "SprintSuggestionExecutionRun"] });
    },
    changeGoals: async (empty = false) => {
      revision = "2026-10-04T11:00:00";
      if (empty) goals = [];
      await client.refetchQueries({ include: ["SprintSuggestionExecution"] });
    },
  };
}

describe("typed sprint execution", () => {
  it("[overhaul-424] runs, reviews, retries and cancels through the sprint card without creating a Conversation or switching the workspace", async () => {
    const f = fixture();
    useClientStore.setState({ selectedModuleId: "module", selectedTaskId: "story", workspaces: {}, activeByTask: {}, focusedPane: "tasks" });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    const before = useClientStore.getState();
    render(<ApolloProvider client={f.client}><input aria-label="Planning notes" /><SuggestionAgentBox projectId="project" sprintId="sprint" /></ApolloProvider>);
    const notes = screen.getByRole("textbox", { name: "Planning notes" });
    notes.focus();
    fireEvent.click(await screen.findByRole("button", { name: "Find stories for these goals" }));
    await screen.findByText("An agent is looking for stories…");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(notes).toHaveFocus();
    expect(useClientStore.getState().selectedTaskId).toBe(before.selectedTaskId);
    expect(useClientStore.getState().activeByTask).toEqual(before.activeByTask);
    expect(useTerminalStore.getState().sessions).toEqual({});
    await act(async () => f.settle("succeeded"));
    expect(await screen.findByText(/2 suggestions ready/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Review in Plan →" })).toBeEnabled();
    expect(notes).toHaveFocus();
    await act(async () => f.changeGoals());
    expect(await screen.findByText("Goals changed since the agent ran")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Find stories again" }));
    await screen.findByText("An agent is looking for stories…");
    await act(async () => f.settle("failed", "The agent returned an invalid suggestion result."));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid suggestion result");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("An agent is looking for stories…");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("Agent cancelled. Your goals are kept.");
    await act(async () => f.changeGoals(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled());
    expect(useClientStore.getState().selectedTaskId).toBe("story");
    expect(useTerminalStore.getState().sessions).toEqual({});
    expect(f.operations).toContain("CreateSprintSuggestionExecution");
    expect(f.operations).toContain("CancelSprintSuggestionExecution");
    f.client.stop();
  });
});
