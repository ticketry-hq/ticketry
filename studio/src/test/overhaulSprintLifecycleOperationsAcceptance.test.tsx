import { ApolloClient, ApolloLink, InMemoryCache, Observable } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { PlanningGraphDocument } from "../features/planning-graph";
import { useCreateSprint, useUpdateSprint } from "../features/sprints";

const createdSprint = { __typename: "WorktrackerSprint", id: "s", name: "Release", status: "planned", createdAt: "2026-10-03" };
const graph = {
  project: { __typename: "WorktrackerProjectConnection", nodes: [] },
  states: { __typename: "WorktrackerStateConnection", nodes: [] },
  issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] },
  sprints: { __typename: "WorktrackerSprintConnection", nodes: [createdSprint] },
  modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
  workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
};

describe("sprint lifecycle operations acceptance", () => {
  it("returns the created id only after the authoritative planning graph arrives", async () => {
    let deliverGraph = () => {};
    let receivedVariables: unknown;
    let graphRequests = 0;
    const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink((operation) => new Observable((observer) => {
      if (operation.operationName === "PlanningGraph") {
        graphRequests += 1;
        deliverGraph = () => { observer.next({ data: graph }); observer.complete(); };
      } else {
        receivedVariables = operation.variables;
        observer.next({ data: { worktrackerSprintCreateOne: { ...createdSprint, __typename: "WorktrackerSprintBasic" } } });
        observer.complete();
      }
    })) });
    const initialGraph = { ...graph, sprints: { __typename: "WorktrackerSprintConnection", nodes: [] } };
    client.writeQuery({ query: PlanningGraphDocument, variables: { projectId: "p" }, data: initialGraph });
    const watcher = client.watchQuery({ query: PlanningGraphDocument, variables: { projectId: "p" } }).subscribe({ next: () => {} });
    const { result } = renderHook(() => useCreateSprint("p"), { wrapper: ({ children }: { children: ReactNode }) => <ApolloProvider client={client}>{children}</ApolloProvider> });
    let settled = false;
    let created: string | null = null;
    try {
      await act(async () => {
        const pending = result.current.create("Release").then((id) => { settled = true; created = id; });
        await waitFor(() => expect(graphRequests).toBe(1));
        expect(receivedVariables).toEqual({ data: { projectId: "p", name: "Release" } });
        expect(settled).toBe(false);
        deliverGraph();
        await pending;
      });
      expect(created).toBe("s");
      expect(client.readQuery({ query: PlanningGraphDocument, variables: { projectId: "p" } })?.sprints.nodes).toEqual([createdSprint]);
    } finally {
      watcher.unsubscribe();
      client.stop();
    }
  });
  it.each([
    { id: "s", status: "active" },
    { id: "s", status: "completed", carryoverSprintId: "next" },
  ])("awaits the authoritative graph after lifecycle update $status", async (variables) => {
    let deliverGraph = () => {};
    let receivedVariables: unknown;
    let graphRequests = 0;
    const updatedSprint = { ...createdSprint, status: variables.status };
    const movedStory = {
      __typename: "WorktrackerIssue", id: "story", name: "Deliver", sequenceId: 12,
      rank: "a", parentId: null, moduleId: null, stateId: null, stateRevision: 1,
      sprintId: variables.carryoverSprintId ?? "s", updatedAt: "2026-10-03", issueType: null,
    };
    const authoritativeGraph = { ...graph, sprints: { ...graph.sprints, nodes: [updatedSprint] }, workItems: { ...graph.workItems, nodes: [movedStory] } };
    const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink((operation) => new Observable((observer) => {
      if (operation.operationName === "PlanningGraph") {
        graphRequests += 1;
        deliverGraph = () => { observer.next({ data: authoritativeGraph }); observer.complete(); };
      } else {
        receivedVariables = operation.variables;
        observer.next({ data: { update_sprint: updatedSprint } });
        observer.complete();
      }
    })) });
    client.writeQuery({ query: PlanningGraphDocument, variables: { projectId: "p" }, data: graph });
    const watcher = client.watchQuery({ query: PlanningGraphDocument, variables: { projectId: "p" } }).subscribe({ next: () => {} });
    const { result } = renderHook(() => useUpdateSprint(), { wrapper: ({ children }: { children: ReactNode }) => <ApolloProvider client={client}>{children}</ApolloProvider> });
    let settled = false;
    let updated = false;
    try {
      await act(async () => {
        const pending = result.current.update(variables).then((success) => { settled = true; updated = success; });
        await waitFor(() => expect(graphRequests).toBe(1));
        expect(receivedVariables).toEqual(variables);
        expect(settled).toBe(false);
        deliverGraph();
        await pending;
      });
      expect(updated).toBe(true);
      const cached = client.readQuery({ query: PlanningGraphDocument, variables: { projectId: "p" } });
      expect(cached?.sprints.nodes[0]?.status).toBe(variables.status);
      expect(cached?.workItems.nodes[0]?.sprintId).toBe(variables.carryoverSprintId ?? "s");
    } finally {
      watcher.unsubscribe();
      client.stop();
    }
  });

  it("preserves the actionable server error for the lifecycle dialogs", async () => {
    let graphRequests = 0;
    const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink((operation) => new Observable((observer) => {
      if (operation.operationName === "PlanningGraph") graphRequests += 1;
      observer.next({ errors: [{ message: "Sprint is completed" }] });
      observer.complete();
    })) });
    const { result } = renderHook(() => ({ create: useCreateSprint("p").create, update: useUpdateSprint().update }), {
      wrapper: ({ children }: { children: ReactNode }) => <ApolloProvider client={client}>{children}</ApolloProvider>,
    });
    try {
      await act(async () => {
        await expect(result.current.create("Release")).rejects.toThrow("Sprint is completed");
        await expect(result.current.update({ id: "s", status: "active" })).rejects.toThrow("Sprint is completed");
      });
      expect(graphRequests).toBe(0);
    } finally {
      client.stop();
    }
  });

});
