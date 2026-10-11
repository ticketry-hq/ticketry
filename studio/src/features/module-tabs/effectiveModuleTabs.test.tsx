import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Module } from "../../shared/api/types";
import { StudioApolloProvider } from "../../shared/apollo/StudioApolloProvider";
import { studioApolloClient } from "../../shared/apollo/client";
import { setStorySprintFilterIntent } from "../work-items";
import { ProjectStorySprintIndexDocument, ProjectStorySprintModulesDocument } from "../work-items/generated/storySprintIndex.documents";
function connection<T>(nodes: T[], total: number, hasNextPage = false) {
  return { __typename: "WorktrackerIssueConnection" as const, nodes,
    pageInfo: { __typename: "PageInfo" as const, hasNextPage },
    paginationInfo: { __typename: "PaginationInfo" as const, total } };
}

import { getEffectiveModuleTabsSnapshot, useEffectiveModuleTabs } from "./index";

it("excludes explicitly hidden sprint modules without overwriting manual hidden preferences", async () => {
  const projectId = "effective-tabs-project";
  const client = studioApolloClient();
  const modules = ["roadmap", "bugs", "release"].map((id) => ({ id, project_id: projectId, is_archived: false })) as Module[];
  const presentations = [{ module_id: "bugs", rank: "b", tab_hidden: true }];
  client.writeQuery({ query: ProjectStorySprintModulesDocument, variables: { projectId }, data: {
    modules: connection(modules.map(({ id }) => ({ __typename: "WorktrackerIssue" as const, id })), 3),
  } });
  client.writeQuery({ query: ProjectStorySprintIndexDocument, variables: { projectId, moduleIds: modules.map(({ id }) => id) }, data: {
    roots: connection([
      { id: "roadmap-root", parent_id: "roadmap", module_id: "roadmap", sprint_id: "sprint-24" },
      { id: "bugs-root", parent_id: "bugs", module_id: "bugs", sprint_id: "sprint-24" },
      { id: "release-root", parent_id: "release", module_id: "release", sprint_id: "sprint-25" },
    ].map((root) => ({ ...root, __typename: "WorktrackerIssue" as const, project_id: projectId, is_archived: false, state_revision: 1, updated_at: "2026-10-08" })), 3),
  } });
  setStorySprintFilterIntent(projectId, { mode: "id", sprintId: "sprint-24" });
  const { result } = renderHook(() => useEffectiveModuleTabs(projectId, modules, presentations), { wrapper: StudioApolloProvider });
  expect(result.current.modules.map(({ id }) => id)).toEqual(["roadmap"]);
  expect(result.current.noMatches).toBe(false);
  act(() => setStorySprintFilterIntent(projectId, { mode: "all" }));
  await waitFor(() => expect(result.current.modules.map(({ id }) => id)).toEqual(["roadmap", "release"]));
  expect(presentations[0].tab_hidden).toBe(true);
  expect(getEffectiveModuleTabsSnapshot("unknown-project").noMatches).toBe(false);
});

it("uses ordinary visibility for unknown or truncated membership and never reports a false zero", () => {
  const projectId = "partial-tabs-project";
  const modules = [{ id: "partial-roadmap", project_id: projectId, is_archived: false }] as Module[];
  setStorySprintFilterIntent(projectId, { mode: "none" });
  const { result, rerender } = renderHook(() => useEffectiveModuleTabs(projectId, modules, []));
  expect(result.current.complete).toBe(false);
  expect(result.current.noMatches).toBe(false);
  expect(result.current.modules.map(({ id }) => id)).toEqual(["partial-roadmap"]);
  act(() => {
    studioApolloClient().writeQuery({ query: ProjectStorySprintModulesDocument, variables: { projectId }, data: {
      modules: connection([{ __typename: "WorktrackerIssue" as const, id: "partial-roadmap" }], 2, true),
    } });
  });
  rerender();
  expect(result.current.complete).toBe(false);
  expect(result.current.noMatches).toBe(false);
  expect(result.current.modules.map(({ id }) => id)).toEqual(["partial-roadmap"]);
});

it("mounts without an Apollo context when no project has been selected", () => {
  const { result } = renderHook(() => useEffectiveModuleTabs(null));
  expect(result.current.noMatches).toBe(false);
  expect(result.current.modules).toEqual([]);
});

it("does not treat a pending project module list's empty fallback as a confirmed zero-match set", () => {
  const projectId = "pending-project-module-list";
  setStorySprintFilterIntent(projectId, { mode: "none" });
  studioApolloClient().writeQuery({ query: ProjectStorySprintModulesDocument, variables: { projectId },
    data: { modules: connection([], 0) } });
  const { result } = renderHook(() => useEffectiveModuleTabs(projectId, []));
  expect(result.current.complete).toBe(false);
  expect(result.current.noMatches).toBe(false);
  expect(getEffectiveModuleTabsSnapshot(projectId).noMatches).toBe(false);
});
