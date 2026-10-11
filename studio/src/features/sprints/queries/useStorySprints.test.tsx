import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createBrowserRuntime, initializeStudioRuntime } from "../../../runtime";
import { studioApolloClient } from "../../../shared/apollo/client";
import { StoryActiveSprintDocument, StorySelectedSprintDocument } from "../generated/storySprintChoices.documents";
import { useActiveStorySprint, useSelectedStorySprint } from "./useStorySprints";

const projectId = "sprint-hook-project";
const sprint = { __typename: "WorktrackerSprint" as const, id: "current-sprint", projectId,
  name: "Current sprint", status: "active", rank: "V", createdAt: "2026-10-08T00:00:00Z" };

describe("active Story sprint read", () => {
  it("distinguishes unknown lookup from authoritative no active sprint and canonical active updates", async () => {
    const client = studioApolloClient();
    const { result } = renderHook(() => useActiveStorySprint(projectId, "cache-only"));
    expect(result.current.ready).toBe(false);
    act(() => { client.writeQuery({ query: StoryActiveSprintDocument, variables: { projectId },
      data: { sprints: { __typename: "WorktrackerSprintConnection", nodes: [] } } }); });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.sprint).toBeNull();
    act(() => { client.writeQuery({ query: StoryActiveSprintDocument, variables: { projectId },
      data: { sprints: { __typename: "WorktrackerSprintConnection", nodes: [sprint] } } }); });
    await waitFor(() => expect(result.current.sprint?.id).toBe("current-sprint"));
  });
});

it("rejects multiple active sprints instead of choosing an arbitrary one", () => {
  const projectId = "ambiguous-active-project";
  studioApolloClient().writeQuery({ query: StoryActiveSprintDocument, variables: { projectId }, data: {
    sprints: { __typename: "WorktrackerSprintConnection", nodes: [
      { ...sprint, id: "ambiguous-a", projectId }, { ...sprint, id: "ambiguous-b", projectId },
    ] },
  } });
  const { result } = renderHook(() => useActiveStorySprint(projectId, "cache-only"));
  expect(result.current.ready).toBe(false);
  expect(result.current.error).toBeDefined();
  expect(result.current.sprint).toBeNull();
});

it("validates explicit sprint identity and does not leak it across projects", () => {
  const projectId = "explicit-sprint-project";
  const client = studioApolloClient();
  client.writeQuery({ query: StorySelectedSprintDocument, variables: { projectId, sprintId: "requested" }, data: {
    sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ ...sprint, id: "other-sprint", projectId }] },
  } });
  const { result, rerender } = renderHook(({ projectId }) => useSelectedStorySprint(projectId, "requested", "cache-only"),
    { initialProps: { projectId } });
  expect(result.current.ready).toBe(false);
  expect(result.current.sprint).toBeNull();
  rerender({ projectId: "other-project" });
  expect(result.current.ready).toBe(false);
  expect(result.current.sprint).toBeNull();
});

it("surfaces malformed transport reads as unavailable and Retry recovers", async () => {
  let malformed = true;
  const browser = createBrowserRuntime({ environment: {} });
  initializeStudioRuntime({ ...browser, graphQlTransport: () => ({
    ...browser.graphQlTransport(),
    graphql_execute: async () => JSON.stringify({ data: malformed ? {} : {
      sprints: { __typename: "WorktrackerSprintConnection", nodes: [] },
    } }),
  }) });
  const { result } = renderHook(() => useActiveStorySprint("malformed-read-project"));
  await waitFor(() => expect(result.current.error).toBeDefined());
  expect(result.current.ready).toBe(false);
  malformed = false;
  await act(async () => { await result.current.retry(); });
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.sprint).toBeNull();
  expect(result.current.error).toBeUndefined();
  initializeStudioRuntime(browser);
});

it("keeps the canonical active sprint visible when a real transport refresh fails", async () => {
  let fail = false;
  const projectId = "failed-refetch-project";
  const browser = createBrowserRuntime({ environment: {} });
  initializeStudioRuntime({ ...browser, graphQlTransport: () => ({
    ...browser.graphQlTransport(),
    graphql_execute: async () => {
      if (fail) throw new Error("Temporary transport outage");
      return JSON.stringify({ data: {
        sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ ...sprint, projectId }] },
      } });
    },
  }) });
  const { result } = renderHook(() => useActiveStorySprint(projectId));
  await waitFor(() => expect(result.current.sprint?.id).toBe("current-sprint"));
  fail = true;
  await act(async () => { await result.current.retry().catch(() => undefined); });
  await waitFor(() => expect(result.current.error).toBeDefined());
  expect(result.current.ready).toBe(true);
  expect(result.current.sprint?.id).toBe("current-sprint");
  initializeStudioRuntime(browser);
});

it("waits for a successful scoped refresh before declaring a cached missing selection unavailable", async () => {
  const projectId = "cached-absence-project";
  const sprintId = "selected-sprint";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const browser = createBrowserRuntime({ environment: {} });
  initializeStudioRuntime({ ...browser, graphQlTransport: () => ({
    ...browser.graphQlTransport(),
    graphql_execute: async () => {
      await gate;
      return JSON.stringify({ data: { sprints: {
        __typename: "WorktrackerSprintConnection", nodes: [{ ...sprint, id: sprintId, projectId, status: "planned" }],
      } } });
    },
  }) });
  studioApolloClient().writeQuery({ query: StorySelectedSprintDocument,
    variables: { projectId, sprintId }, data: { sprints: { __typename: "WorktrackerSprintConnection", nodes: [] } } });
  const { result } = renderHook(() => useSelectedStorySprint(projectId, sprintId));
  expect(result.current.loading).toBe(true);
  expect(result.current.ready).toBe(false);
  await act(async () => release());
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.sprint?.id).toBe(sprintId);
  initializeStudioRuntime(browser);
});
