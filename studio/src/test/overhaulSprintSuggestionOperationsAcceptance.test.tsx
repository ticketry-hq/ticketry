import { ApolloClient, ApolloLink, InMemoryCache, Observable } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { PlanningGraphDocument } from "../features/planning-graph";
import {
  SprintSuggestionsDocument, useSprintSuggestions, useUpdateSprintSuggestion,
  type SprintSuggestionRecordFragment,
} from "../features/sprints";

const story = {
  __typename: "WorktrackerIssue", id: "story", name: "Deliver", sequenceId: 12,
  rank: "a", parentId: null, moduleId: "epic", stateId: null, stateRevision: 1,
  sprintId: null, updatedAt: "2026-10-03", issueType: null,
} satisfies NonNullable<SprintSuggestionRecordFragment["issue"]>;

function suggestion(proposal: boolean): SprintSuggestionRecordFragment {
  return {
    __typename: "WorktrackerSprintSuggestion", id: "suggestion", sprintId: "s",
    goalId: "goal", issueId: proposal ? null : story.id,
    proposedName: proposal ? "Deliver" : null, proposedEpicId: proposal ? "epic" : null,
    reason: "Fits the goal", status: "waiting", runId: "run", createdAt: "2026-10-03",
    issue: proposal ? null : story,
  };
}

function suggestionData(row: SprintSuggestionRecordFragment) {
  return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [row] } };
}

function cardData(row: SprintSuggestionRecordFragment) {
  return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [{
    __typename: "WorktrackerSprint", id: row.sprintId, status: "planned", suggestionRunId: row.runId,
    goalsRevisedAt: null, goals: { __typename: "WorktrackerSprintGoalConnection", nodes: [] },
    suggestions: { __typename: "WorktrackerSprintSuggestionConnection", nodes: row.status === "waiting"
      ? [{ __typename: "WorktrackerSprintSuggestion", id: row.id }] : [] },
  }] } };
}

const emptyGraph = {
  project: { __typename: "WorktrackerProjectConnection", nodes: [] },
  states: { __typename: "WorktrackerStateConnection", nodes: [] },
  issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] },
  sprints: { __typename: "WorktrackerSprintConnection", nodes: [] },
  modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
  workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
};

describe("suggestion operation acceptance", () => {
  it("[overhaul-422] accepts existing stories and proposals, then Undoes with authoritative closed-view collections", async () => {
    for (const proposal of [false, true]) {
      let row = suggestion(proposal);
      let deliverGraph = () => {};
      let deliverSuggestions = () => {};
      let deliverCard = () => {};
      const requests: { name: string; variables: unknown }[] = [];
      const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink((operation) => new Observable((observer) => {
        requests.push({ name: operation.operationName ?? "", variables: operation.variables });
        if (operation.operationName === "UpdateSprintSuggestion") {
          if (typeof operation.variables.status !== "string") throw new Error("Missing status");
          const accepted = operation.variables.status === "accepted";
          row = { ...row, status: operation.variables.status, issueId: story.id,
            issue: { ...story, sprintId: accepted ? "s" : null, stateRevision: accepted ? 2 : 3 } };
          observer.next({ data: { update_sprint_suggestion: row } });
          observer.complete();
        } else if (operation.operationName === "PlanningGraph") {
          deliverGraph = () => {
            observer.next({ data: { ...emptyGraph, workItems: { ...emptyGraph.workItems, nodes: [row.issue] } } });
            observer.complete();
          };
        } else if (operation.operationName === "SprintSuggestionExecution") {
          deliverCard = () => { observer.next({ data: cardData(row) }); observer.complete(); };
        } else {
          deliverSuggestions = () => {
            observer.next({ data: suggestionData(row) });
            observer.complete();
          };
        }
      })) });
      client.writeQuery({ query: PlanningGraphDocument, variables: { projectId: "p" }, data: emptyGraph });
      client.writeQuery({ query: SprintSuggestionsDocument, variables: { sprintId: "s" }, data: suggestionData(row) });
      const { result, unmount } = renderHook(() => useUpdateSprintSuggestion({ projectId: "p", sprintId: "s" }), {
        wrapper: ({ children }: { children: ReactNode }) => <ApolloProvider client={client}>{children}</ApolloProvider>,
      });
      try {
        for (const status of ["accepted", "waiting"]) {
          requests.length = 0;
          let settled = false;
          await act(async () => {
            const pending = result.current.update({ id: row.id, status, ...(proposal && status === "accepted" ? { proposedName: "Deliver" } : {}) })
              .then((value) => { settled = true; return value; });
            await waitFor(() => expect(requests).toHaveLength(4));
            expect(settled).toBe(false);
            deliverGraph();
            await Promise.resolve();
            expect(settled).toBe(false);
            deliverSuggestions();
            await Promise.resolve();
            expect(settled).toBe(false);
            deliverCard();
            expect((await pending)?.issue?.id).toBe(story.id);
          });
          expect(requests.slice(1)).toEqual(expect.arrayContaining([
            { name: "PlanningGraph", variables: { projectId: "p" } },
            { name: "SprintSuggestions", variables: { sprintId: "s" } },
            { name: "SprintSuggestionExecution", variables: { sprintId: "s" } },
          ]));
          expect(client.readQuery({ query: PlanningGraphDocument, variables: { projectId: "p" } })?.workItems.nodes[0]?.sprintId)
            .toBe(status === "accepted" ? "s" : null);
          expect(client.readQuery({ query: SprintSuggestionsDocument, variables: { sprintId: "s" } })?.worktrackerSprintSuggestion.nodes[0])
            .toEqual(row);
        }
        expect(row.issueId).toBe(story.id);
        expect(row.status).toBe("waiting");
      } finally { unmount(); client.stop(); }
    }
  });

  it("[overhaul-423] dismisses and Undoes in the shared suggestion query and preserves failed transitions", async () => {
    let row = suggestion(false);
    let reject = false;
    let reads = 0;
    const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink((operation) => new Observable((observer) => {
      if (operation.operationName === "UpdateSprintSuggestion") {
        if (typeof operation.variables.status !== "string") throw new Error("Missing status");
        if (reject) observer.next({ errors: [{ message: "Sprint is completed" }] });
        else {
          row = { ...row, status: operation.variables.status };
          observer.next({ data: { update_sprint_suggestion: row } });
        }
      } else if (operation.operationName === "SprintSuggestions") {
        reads += 1;
        observer.next({ data: suggestionData(row) });
      } else if (operation.operationName === "SprintSuggestionExecution") observer.next({ data: cardData(row) });
      else observer.next({ data: emptyGraph });
      observer.complete();
    })) });
    const { result, unmount } = renderHook(() => ({
      ...useUpdateSprintSuggestion({ projectId: "p", sprintId: "s" }),
      ...useSprintSuggestions("s"),
    }), { wrapper: ({ children }: { children: ReactNode }) => <ApolloProvider client={client}>{children}</ApolloProvider> });
    try {
      await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
      for (const status of ["dismissed", "waiting"]) {
        await act(async () => { await result.current.update({ id: row.id, status }); });
        expect(result.current.suggestions[0]?.status).toBe(status);
        expect(result.current.suggestions[0]?.issue?.sprintId).toBeNull();
      }
      reject = true;
      const readsBeforeFailure = reads;
      await act(async () => { await expect(result.current.update({ id: row.id, status: "accepted" })).rejects.toThrow("Sprint is completed"); });
      expect(reads).toBe(readsBeforeFailure);
      expect(result.current.suggestions[0]?.status).toBe("waiting");
    } finally { unmount(); client.stop(); }
  });
});
