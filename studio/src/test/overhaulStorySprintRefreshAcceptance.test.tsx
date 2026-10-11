import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createBrowserRuntime, initializeStudioRuntime } from "../runtime";
import { studioApolloClient } from "../shared/apollo/client";
import { getProjectStorySprintIndexSnapshot, useProjectStorySprintIndex } from "../features/work-items/queries/useProjectStorySprintIndex";
import { refreshProjectStorySprintIndex } from "../features/work-items/queries/refreshProjectStorySprintIndex";
import { ProjectStorySprintModulesDocument } from "../features/work-items/generated/storySprintIndex.documents";

const browser = createBrowserRuntime({ environment: {} });
afterEach(() => initializeStudioRuntime(browser));
function boundary() {
  const requests: Array<{ operation: string; project: string; moduleIds?: string[] }> = [];
  const modules = new Map<string, string[]>();
  const extraRoots = new Map<string, string[]>();
  let beforeRoots: (project: string) => Promise<void> = async () => {};
  let beforeModules: (project: string) => Promise<void> = async () => {};
  const connection = (nodes: unknown[]) => ({ __typename: "WorktrackerIssueConnection", nodes,
    pageInfo: { __typename: "PageInfo", hasNextPage: false }, paginationInfo: { __typename: "PaginationInfo", total: nodes.length } });
  initializeStudioRuntime({ ...browser, graphQlTransport: () => ({ ...browser.graphQlTransport(), graphql_execute: async (encoded) => {
    const { operationName, variables } = JSON.parse(encoded);
    const { projectId, moduleIds } = variables;
    requests.push({ operation: operationName, project: projectId, moduleIds });
    if (operationName === "ProjectStorySprintModules") {
      await beforeModules(projectId);
      return JSON.stringify({ data: { modules: connection((modules.get(projectId) ?? [`${projectId}-module`]).map((id) => ({ __typename: "WorktrackerIssue", id }))) } });
    }
    const roots = [...moduleIds.map((id: string) => ({
      __typename: "WorktrackerIssue", id: `${id}-root`, project_id: projectId, parent_id: id, module_id: id,
      sprint_id: `${projectId}-active`, is_archived: false, updated_at: "2026-10-08T11:00:00Z", state_revision: 1,
    })), ...(extraRoots.get(projectId) ?? []).map((id) => ({
      __typename: "WorktrackerIssue", id, project_id: projectId, parent_id: moduleIds[0], module_id: moduleIds[0],
      sprint_id: `${projectId}-active`, is_archived: false, updated_at: "2026-10-08T11:01:00Z", state_revision: 1,
    }))];
    await beforeRoots(projectId);
    return JSON.stringify({ data: { roots: connection(roots) } });
  } }) });
  return { requests, modules, extraRoots, beforeRoots: (next: typeof beforeRoots) => { beforeRoots = next; }, beforeModules: (next: typeof beforeModules) => { beforeModules = next; } };
}

it("[overhaul-507] invalidates closed root memberships only for the affected project and refreshes cached roots on project entry", async () => {
  const server = boundary();
  const first = renderHook(() => useProjectStorySprintIndex("first-project"));
  const other = renderHook(() => useProjectStorySprintIndex("other-project"));
  await waitFor(() => expect(first.result.current.complete && other.result.current.complete).toBe(true));
  first.unmount();
  await waitFor(() => expect([...studioApolloClient().getObservableQueries("active").values()].filter((query) => query.variables.projectId === "first-project")).toHaveLength(0));
  const otherReads = server.requests.filter((request) => request.project === "other-project").length;
  await refreshProjectStorySprintIndex("first-project");
  expect(getProjectStorySprintIndexSnapshot("first-project").complete).toBe(false);
  expect(getProjectStorySprintIndexSnapshot("other-project").roots.map((root) => root.id)).toEqual(["other-project-module-root"]);
  expect(server.requests.filter((request) => request.project === "other-project")).toHaveLength(otherReads);
  const mounted = renderHook(() => useProjectStorySprintIndex("first-project"));
  await waitFor(() => expect(mounted.result.current.complete).toBe(true));
  const reads = server.requests.filter((request) => request.project === "first-project" && request.operation === "ProjectStorySprintIndex").length;
  mounted.unmount();
  renderHook(() => useProjectStorySprintIndex("first-project"));
  await waitFor(() => expect(server.requests.filter((request) => request.project === "first-project" && request.operation === "ProjectStorySprintIndex")).toHaveLength(reads + 1));
});

it("[overhaul-508] cannot redirect the current project when an old project's module refresh completes late", async () => {
  const server = boundary();
  const view = renderHook(({ project }) => useProjectStorySprintIndex(project), { initialProps: { project: "old-project" } });
  await waitFor(() => expect(view.result.current.complete).toBe(true));
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  server.beforeModules(async (project) => { if (project === "old-project") await pending; });
  const oldReads = server.requests.filter((request) => request.project === "old-project" && request.operation === "ProjectStorySprintIndex").length;
  let refreshing: Promise<void>;
  act(() => { refreshing = view.result.current.retry(); });
  view.rerender({ project: "new-project" });
  await waitFor(() => expect(view.result.current.roots.map((root) => root.id)).toEqual(["new-project-module-root"]));
  await act(async () => { release(); await refreshing!; });
  expect(view.result.current.roots.map((root) => root.id)).toEqual(["new-project-module-root"]);
  expect(server.requests.filter((request) => request.project === "old-project" && request.operation === "ProjectStorySprintIndex")).toHaveLength(oldReads);
});

it("[overhaul-509] refreshes new module IDs before roots and excludes modules archived from the authoritative list", async () => {
  const server = boundary();
  const view = renderHook(() => useProjectStorySprintIndex("module-project"));
  await waitFor(() => expect(view.result.current.complete).toBe(true));
  let release = () => {};
  const oldRootRead = new Promise<void>((resolve) => { release = resolve; });
  server.beforeRoots(async () => oldRootRead);
  const initialRootReads = server.requests.filter((request) => request.operation === "ProjectStorySprintIndex").length;
  let beforeWrite: Promise<void>;
  act(() => { beforeWrite = view.result.current.retry(); });
  await waitFor(() => expect(server.requests.filter((request) => request.operation === "ProjectStorySprintIndex")).toHaveLength(initialRootReads + 1));
  // A structural fact arrives after the pending read already took its old snapshot.
  server.extraRoots.set("module-project", ["newly-created-root"]);
  let afterWrite: Promise<void>;
  act(() => { afterWrite = view.result.current.retry(); });
  await act(async () => {});
  server.beforeRoots(async () => {});
  await act(async () => { release(); await Promise.all([beforeWrite!, afterWrite!]); });
  await waitFor(() => expect(view.result.current.roots.map((root) => root.id)).toEqual(["module-project-module-root", "newly-created-root"]));
  server.extraRoots.clear();
  server.modules.set("module-project", ["new-module"]);
  await act(async () => { await view.result.current.retry(); });
  await waitFor(() => expect(view.result.current.roots.map((root) => root.id)).toEqual(["new-module-root"]));
  expect(server.requests.filter((request) => request.operation === "ProjectStorySprintIndex").at(-1)?.moduleIds).toEqual(["new-module"]);
  let releaseInitial = () => {};
  const initialRead = new Promise<void>((resolve) => { releaseInitial = resolve; });
  server.beforeRoots(async (project) => { if (project === "initial-project") await initialRead; });
  const initial = renderHook(() => useProjectStorySprintIndex("initial-project"));
  await waitFor(() => expect(server.requests.some((request) => request.project === "initial-project"
    && request.operation === "ProjectStorySprintIndex")).toBe(true));
  server.extraRoots.set("initial-project", ["created-during-project-entry"]);
  let entryRefresh: Promise<void>;
  act(() => { entryRefresh = initial.result.current.retry(); });
  await act(async () => {});
  server.beforeRoots(async () => {});
  await act(async () => { releaseInitial(); await entryRefresh!; });
  await waitFor(() => expect(initial.result.current.roots.map((root) => root.id))
    .toEqual(["initial-project-module-root", "created-during-project-entry"]));
  expect(view.result.current.roots.map((root) => root.id)).toEqual(["new-module-root"]);
  server.modules.set("module-project", []);
  await act(async () => { await view.result.current.retry(); });
  expect(view.result.current.complete).toBe(true);
  expect(view.result.current.roots).toEqual([]);
  expect(getProjectStorySprintIndexSnapshot("module-project").roots).toEqual([]);
  expect(studioApolloClient().readQuery({ query: ProjectStorySprintModulesDocument, variables: { projectId: "module-project" } })?.modules.nodes).toEqual([]);
});
