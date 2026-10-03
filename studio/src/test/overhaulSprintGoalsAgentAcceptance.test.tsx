import { beforeEach, describe, expect, it } from "vitest";
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SuggestionAgentBox } from "../features/sprints/suggestions/SuggestionAgentBox";
import type { SprintExecutionRecordFragment } from "../features/sprints/generated/sprints.documents";
import { launchSuggestionRun } from "../features/sprints/suggestions/launchSuggestionRun";
import { useClientStore } from "../state/clientStore";
import { useTerminalStore } from "../features/agents/terminal";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";

const sprint = { id: "sprint-1", projectId: "project-1" };

beforeEach(() => {
  useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  useClientStore.setState({
    selectedModuleId: null, selectedTaskId: "story-1", workspaceSelection: { kind: "task" },
    workspaces: {}, activeByTask: {}, focusedPane: "tasks",
  });
});

function cardFixture(initialState: string | null, revised = false, options: { holdLaunch?: boolean; launchError?: string; holdRead?: boolean; readError?: string; noGoals?: boolean; boundRunId?: string; missingRun?: boolean } = {}) {
  let present = initialState !== null;
  let releaseLaunch = () => {};
  let releaseRead = () => {};
  let execution: SprintExecutionRecordFragment = {
    __typename: "AgentExecutions", id: "execution-1", agentRunId: options.boundRunId ?? "run-1", sprintId: "sprint-1",
    outputType: "sprint_suggestions_v1", state: initialState ?? "queued", error: "Provider disconnected",
    cancelRequested: false, goalsRevision: "2026-10-04T00:00:00Z",
    createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z",
  };
  const operations: string[] = [];
  const runRequests: string[] = [];
  const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink((operation) =>
    new Observable((observer) => {
      operations.push(operation.operationName ?? "Anonymous");
      if (operation.operationName === "SprintSuggestionExecution") {
        const deliver = () => {
          if (options.readError) { observer.error(new Error(options.readError)); return; }
          observer.next({ data: {
          worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [{
            __typename: "WorktrackerSprint", id: "sprint-1", status: "planned",
            suggestionRunId: present ? options.boundRunId ?? execution.agentRunId : null,
            goalsRevisedAt: revised ? "2026-10-04T01:00:00Z" : execution.goalsRevision,
            goals: { __typename: "WorktrackerSprintGoalConnection", nodes: options.noGoals ? [] : [{ __typename: "WorktrackerSprintGoal", id: "goal-1", text: "Ship planning" }] },
            suggestions: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [{ __typename: "WorktrackerSprintSuggestion", id: "suggestion-1" }] },
          }] },
        } });
          observer.complete();
        };
        if (options.holdRead) { releaseRead = deliver; return; }
        deliver();
      } else if (operation.operationName === "SprintSuggestionExecutionRun") {
        runRequests.push(operation.variables.agentRunId);
        observer.next({ data: { agentExecutions: { __typename: "AgentExecutionsConnection", nodes: options.missingRun ? [] : [execution] } } });
      } else if (operation.operationName === "CreateSprintSuggestionExecution") {
        const deliver = () => {
          if (options.launchError) { observer.error(new Error(options.launchError)); return; }
          present = true;
          execution = { ...execution, state: "running", error: null };
          observer.next({ data: { agent_execution_create: execution } });
          observer.complete();
        };
        if (options.holdLaunch) { releaseLaunch = deliver; return; }
        deliver();
      } else if (operation.operationName === "CancelSprintSuggestionExecution") {
        execution = { ...execution, state: "cancelled", cancelRequested: true };
        observer.next({ data: { agent_execution_update: execution } });
      } else observer.error(new Error(`Unexpected operation ${operation.operationName}`));
      observer.complete();
    })),
  });
  return { client, operations, runRequests, releaseLaunch: () => releaseLaunch(), releaseRead: () => releaseRead() };
}

describe("persisted sprint agent card", () => {
  it("[overhaul-462] recovers a failed status read without launching or losing the persisted result", async () => {
    const options = { readError: "Status unavailable", holdRead: false };
    const f = cardFixture("succeeded", false, options);
    render(<ApolloProvider client={f.client}><SuggestionAgentBox projectId={sprint.projectId} sprintId={sprint.id} /></ApolloProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Status unavailable");
    options.readError = "";
    options.holdRead = true;
    fireEvent.click(screen.getByRole("button", { name: "Retry status" }));
    const retrying = screen.getByRole("button", { name: "Retrying status…" });
    expect(retrying).toBeDisabled();
    fireEvent.click(retrying);
    expect(f.operations.filter((name) => name === "SprintSuggestionExecution")).toHaveLength(2);
    options.holdRead = false;
    await act(async () => f.releaseRead());
    expect(await screen.findByText(/1 suggestions ready/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Review in Plan →" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(f.operations).not.toContain("CreateSprintSuggestionExecution");
    expect(f.runRequests.every((id) => id === "run-1")).toBe(true);
    options.readError = "Status unavailable again";
    await act(async () => { await f.client.refetchQueries({ include: ["SprintSuggestionExecution"] }).catch(() => {}); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Status unavailable again");
    expect(screen.getByText(/1 suggestions ready/)).toBeVisible();
    options.readError = "";
    fireEvent.click(screen.getByRole("button", { name: "Retry status" }));
    await screen.findByRole("button", { name: "Find stories again" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    f.client.stop();
  });

  it("[overhaul-428] shows changed goals instead of a superseded failure and keeps running cancellation available", async () => {
    const failed = cardFixture("failed", true);
    const view = render(<ApolloProvider client={failed.client}><SuggestionAgentBox {...{ projectId: sprint.projectId, sprintId: sprint.id }} /></ApolloProvider>);
    expect(await screen.findByText("Goals changed since the agent ran")).toBeVisible();
    expect(screen.queryByText(/The agent couldn’t finish/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review in Plan →" })).not.toBeInTheDocument();
    view.unmount();
    failed.client.stop();
    const running = cardFixture("running", true);
    render(<ApolloProvider client={running.client}><SuggestionAgentBox {...{ projectId: sprint.projectId, sprintId: sprint.id }} /></ApolloProvider>);
    expect(await screen.findByRole("progressbar", { name: "Finding stories" })).toBeVisible();
    expect(screen.queryByText("Goals changed since the agent ran")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Agent cancelled. Your goals are kept.")).toBeVisible();
    expect(running.operations).toContain("CancelSprintSuggestionExecution");
    running.client.stop();
  });

  it("[overhaul-429] restores completed results and failure reasons from fresh persisted queries", async () => {
    for (const state of ["succeeded", "failed"]) {
      const f = cardFixture(state);
      const view = render(<ApolloProvider client={f.client}><SuggestionAgentBox projectId={sprint.projectId} sprintId={sprint.id} /></ApolloProvider>);
      if (state === "succeeded") {
        expect(await screen.findByText(/1 suggestions ready/)).toBeVisible();
        expect(screen.getByRole("button", { name: "Review in Plan →" })).toBeEnabled();
      } else {
        expect(await screen.findByRole("alert")).toHaveTextContent("Provider disconnected");
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(await screen.findByText("An agent is looking for stories…")).toBeVisible();
        expect(f.operations.filter((name) => name === "CreateSprintSuggestionExecution")).toHaveLength(1);
      }
      view.unmount();
      f.client.stop();
    }
  });

  it("[overhaul-430] disables repeated starts until launch settles and preserves a rejected launch reason", async () => {
    const f = cardFixture(null, false, { holdLaunch: true, launchError: "Provider unavailable" });
    render(<ApolloProvider client={f.client}><SuggestionAgentBox projectId={sprint.projectId} sprintId={sprint.id} /></ApolloProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Find stories for these goals" }));
    const pending = screen.getByRole("button", { name: "Starting…" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(f.operations.filter((name) => name === "CreateSprintSuggestionExecution")).toHaveLength(1);
    await act(async () => f.releaseLaunch());
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    f.client.stop();
  });

  it("[overhaul-431] queries the persisted run identity and prevents launching while its execution is unavailable", async () => {
    const f = cardFixture("failed", false, { boundRunId: "persisted-older-run" });
    const view = render(<ApolloProvider client={f.client}><SuggestionAgentBox projectId={sprint.projectId} sprintId={sprint.id} /></ApolloProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider disconnected");
    expect(f.runRequests).toEqual(["persisted-older-run"]);
    view.unmount();
    f.client.stop();
    const options = { missingRun: true };
    const missing = cardFixture("running", false, options);
    render(<ApolloProvider client={missing.client}><SuggestionAgentBox projectId={sprint.projectId} sprintId={sprint.id} /></ApolloProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("agent run could not be found");
    expect(screen.getByRole("button", { name: "Find stories for these goals" })).toBeDisabled();
    options.missingRun = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry status" }));
    expect(await screen.findByText("An agent is looking for stories…")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(missing.operations).not.toContain("CreateSprintSuggestionExecution");
    missing.client.stop();
  });

  it("[overhaul-432] prevents starts while status loads, when reads fail, and when there are no goals", async () => {
    const loading = cardFixture(null, false, { holdRead: true });
    const view = render(<ApolloProvider client={loading.client}><SuggestionAgentBox projectId={sprint.projectId} sprintId={sprint.id} /></ApolloProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading agent status");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(loading.operations).not.toContain("CreateSprintSuggestionExecution");
    await act(async () => loading.releaseRead());
    expect(await screen.findByRole("button", { name: "Find stories for these goals" })).toBeEnabled();
    view.unmount();
    loading.client.stop();
    for (const options of [{ readError: "Status unavailable" }, { noGoals: true }]) {
      const f = cardFixture(null, false, options);
      const card = render(<ApolloProvider client={f.client}><SuggestionAgentBox projectId={sprint.projectId} sprintId={sprint.id} /></ApolloProvider>);
      expect(await screen.findByRole("button", { name: "Find stories for these goals" })).toBeDisabled();
      if ("readError" in options) expect(screen.getByRole("alert")).toHaveTextContent("Status unavailable");
      else expect(screen.getByText("Add goals, then an agent can look for stories that fit them.")).toBeVisible();
      expect(f.operations).not.toContain("CreateSprintSuggestionExecution");
      card.unmount();
      f.client.stop();
    }
  });
});

describe("goal-scoped suggestion launch", () => {
  it("[overhaul-427] returns the persisted typed execution run identity without changing the workspace", async () => {
    let launches = 0;
    const operations = installDesktopGraphQlRuntime(async (document) => {
      const name = documentOperationName(document);
      if (name !== "CreateSprintSuggestionExecution") throw new Error(`Unexpected operation ${name}`);
      launches += 1;
      return { agent_execution_create: {
        __typename: "AgentExecutions", id: `execution-${launches}`, agentRunId: `persisted-run-${launches}`,
        sprintId: sprint.id, outputType: "sprint_suggestions_v1", state: "queued", error: null,
        cancelRequested: false, goalsRevision: "2026-10-04T00:00:00Z",
        createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z",
      } } as never;
    });
    const workspace = useClientStore.getState();
    const terminals = useTerminalStore.getState();
    expect(await launchSuggestionRun(sprint)).toBe("persisted-run-1");
    expect(await launchSuggestionRun(sprint)).toBe("persisted-run-2");
    expect(operations).toHaveLength(2);
    for (const operation of operations) {
      expect(operation.operationName).toBe("CreateSprintSuggestionExecution");
      expect(operation.variables).toEqual({
        projectId: "project-1", sprintId: "sprint-1",
        clientRequestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      });
    }
    expect(operations[0]?.variables).not.toEqual(operations[1]?.variables);
    expect(useClientStore.getState()).toMatchObject({
      selectedTaskId: workspace.selectedTaskId, selectedModuleId: workspace.selectedModuleId,
      workspaceSelection: workspace.workspaceSelection, focusedPane: workspace.focusedPane,
      workspaces: workspace.workspaces, activeByTask: workspace.activeByTask,
    });
    expect(useTerminalStore.getState()).toMatchObject({ sessions: terminals.sessions, sessionByRun: terminals.sessionByRun });
  });

  it("preserves a rejected execution's server reason without issuing another operation", async () => {
    const operations = installDesktopGraphQlRuntime(async () => { throw new Error("This sprint has no goals."); });
    await expect(launchSuggestionRun(sprint)).rejects.toThrow("This sprint has no goals.");
    expect(operations.map((operation) => operation.operationName)).toEqual(["CreateSprintSuggestionExecution"]);
    expect(useClientStore.getState().selectedTaskId).toBe("story-1");
    expect(useTerminalStore.getState().sessions).toEqual({});
  });
});
