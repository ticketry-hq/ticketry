import { gql } from "@apollo/client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { createBrowserRuntime, initializeStudioRuntime } from "../../../runtime";
import { StudioApolloProvider } from "../../../shared/apollo/StudioApolloProvider";
import { studioApolloClient } from "../../../shared/apollo/client";
import { ProjectStorySprintIndexDocument, ProjectStorySprintModulesDocument } from "../generated/storySprintIndex.documents";
import { getProjectStorySprintIndexSnapshot, useProjectStorySprintIndex } from "./useProjectStorySprintIndex";

it("rejects partial project membership and reacts to canonical sprint fields without copying server state", async () => {
  const client = studioApolloClient();
  const projectId = "root-read-project";
  const moduleData = { modules: { __typename: "WorktrackerIssueConnection", nodes: [{ __typename: "WorktrackerIssue" as const, id: "root-read-module" }],
      pageInfo: { __typename: "PageInfo" as const, hasNextPage: false }, paginationInfo: { __typename: "PaginationInfo" as const, total: 1 } },
  };
  client.writeQuery({ query: ProjectStorySprintModulesDocument, variables: { projectId }, data: moduleData });
  const root = { __typename: "WorktrackerIssue" as const, id: "indexed-root", project_id: projectId,
    parent_id: "root-read-module", module_id: "root-read-module", sprint_id: null, is_archived: false, state_revision: 1, updated_at: "2026-10-08" };
  const write = (hasNextPage: boolean, sprintId: string | null) => {
    const data = { roots: { __typename: "WorktrackerIssueConnection", nodes: [{ ...root, sprint_id: sprintId }],
      pageInfo: { __typename: "PageInfo" as const, hasNextPage }, paginationInfo: { __typename: "PaginationInfo" as const, total: hasNextPage ? 2 : 1 } },
    };
    return client.writeQuery({
    query: ProjectStorySprintIndexDocument, variables: { projectId, moduleIds: ["root-read-module"] }, data,
  }); };
  write(true, null);
  const { result } = renderHook(() => useProjectStorySprintIndex(projectId, "cache-only"));
  expect(result.current.complete).toBe(false);
  expect(result.current.roots).toEqual([]);
  act(() => { write(false, "active-sprint"); });
  await waitFor(() => expect(result.current.complete).toBe(true));
  expect(result.current.roots[0].sprint_id).toBe("active-sprint");
  expect(getProjectStorySprintIndexSnapshot(projectId).roots[0].sprint_id).toBe("active-sprint");
  expect(getProjectStorySprintIndexSnapshot("another-project").complete).toBe(false);
  act(() => { client.cache.recordOptimisticTransaction((cache) => {
    cache.writeFragment({ fragment: gql`fragment SprintMembershipUpdate on WorktrackerIssue { id sprintId }`,
      data: { __typename: "WorktrackerIssue", id: "indexed-root", sprintId: null } });
  }, "sprint-membership-change"); });
  await waitFor(() => expect(result.current.roots[0].sprint_id).toBeNull());
  expect(getProjectStorySprintIndexSnapshot(projectId).roots[0].sprint_id).toBeNull();
  act(() => { client.cache.removeOptimistic("sprint-membership-change"); });
  await waitFor(() => expect(result.current.roots[0].sprint_id).toBe("active-sprint"));
});

it("preserves complete cached project roots through module and root transport refresh failures", async () => {
  let failedOperation: string | null = null;
  const projectId = "index-refetch-project";
  const browser = createBrowserRuntime({ environment: {} });
  initializeStudioRuntime({ ...browser, graphQlTransport: () => ({
    ...browser.graphQlTransport(),
    graphql_execute: async (encoded) => {
      const { operationName } = JSON.parse(encoded);
      if (operationName === failedOperation) throw new Error("Temporary membership outage");
      return JSON.stringify({ data: operationName === "ProjectStorySprintModules" ? {
        modules: { __typename: "WorktrackerIssueConnection", nodes: [
          { __typename: "WorktrackerIssue", id: "index-refetch-module" },
        ], pageInfo: { __typename: "PageInfo", hasNextPage: false },
          paginationInfo: { __typename: "PaginationInfo", total: 1 } },
      } : {
        roots: { __typename: "WorktrackerIssueConnection", nodes: [{
          __typename: "WorktrackerIssue", id: "retained-project-root", project_id: projectId,
          parent_id: "index-refetch-module", module_id: "index-refetch-module",
          sprint_id: "retained-active-sprint", is_archived: false, state_revision: 1, updated_at: "2026-10-08",
        }], pageInfo: { __typename: "PageInfo", hasNextPage: false },
          paginationInfo: { __typename: "PaginationInfo", total: 1 } },
      } });
    },
  }) });
  const { result } = renderHook(() => useProjectStorySprintIndex(projectId), {
    wrapper: ({ children }) => <StudioApolloProvider>{children}</StudioApolloProvider>,
  });
  await waitFor(() => expect(result.current.complete).toBe(true));
  for (const operation of ["ProjectStorySprintIndex", "ProjectStorySprintModules"]) {
    failedOperation = operation;
    await act(async () => { await result.current.retry().catch(() => undefined); });
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.complete).toBe(true);
    expect(result.current.roots.map((root) => root.id)).toEqual(["retained-project-root"]);
    expect(result.current.roots[0].sprint_id).toBe("retained-active-sprint");
  }
  initializeStudioRuntime(browser);
});
