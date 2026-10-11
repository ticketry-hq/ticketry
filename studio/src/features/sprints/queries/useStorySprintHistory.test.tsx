import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createBrowserRuntime, initializeStudioRuntime } from "../../../runtime";
import { refreshSprintChoices, useStorySprintHistory } from "../index";

type Request = { variables: { filters: { projectId: { eq: string }; status: { eq: string }; name?: { contains: string } }; order: unknown; pagination: { offset: { offset: number; limit: number } } } };
const browser = createBrowserRuntime({ environment: {} });
afterEach(() => initializeStudioRuntime(browser));

function transport(deliver: (request: Request) => Promise<unknown> | unknown) {
  const requests: Request[] = [];
  initializeStudioRuntime({ ...browser, graphQlTransport: () => ({ ...browser.graphQlTransport(),
    graphql_execute: async (encoded) => {
      const request = JSON.parse(encoded) as Request;
      requests.push(request);
      return JSON.stringify({ data: await deliver(request) });
    },
  }) });
  return requests;
}

function page(request: Request, total = 14) {
  const { projectId, status } = request.variables.filters;
  const offset = request.variables.pagination.offset.offset;
  return { sprints: { __typename: "WorktrackerSprintConnection", nodes: Array.from({ length: Math.min(5, total - offset) }, (_, i) => ({
    __typename: "WorktrackerSprint", id: `${projectId.eq}-${status.eq}-${offset + i}`, projectId: projectId.eq,
    name: `Sprint ${offset + i}`, status: status.eq, rank: `V${offset + i}`, createdAt: "2026-10-08T00:00:00Z",
  })), paginationInfo: { __typename: "PaginationInfo", total }, pageInfo: { __typename: "PageInfo", hasNextPage: offset + 5 < total } } };
}

it("opens bounded independent status pages and retains loaded choices on reopen", async () => {
  const requests = transport(page);
  const { result, rerender } = renderHook(({ open }) => useStorySprintHistory("history-project", "", open), { initialProps: { open: false } });
  expect(requests).toHaveLength(0);
  rerender({ open: true });
  await waitFor(() => expect(result.current.planned.sprints).toHaveLength(5));
  expect(result.current.completed.sprints).toHaveLength(5);
  expect(result.current.planned.total).toBe(14);
  expect(requests.map((request) => request.variables)).toEqual([
    { filters: { projectId: { eq: "history-project" }, status: { eq: "planned" } }, order: { rank: "ASC", id: "ASC" }, pagination: { offset: { limit: 5, offset: 0 } } },
    { filters: { projectId: { eq: "history-project" }, status: { eq: "completed" } }, order: { rank: "DESC", id: "DESC" }, pagination: { offset: { limit: 5, offset: 0 } } },
  ]);
  await act(async () => { await result.current.planned.loadMore(); });
  expect(result.current.planned.sprints).toHaveLength(10);
  expect(result.current.completed.sprints).toHaveLength(5);
  expect(requests[2]?.variables.pagination.offset).toEqual({ limit: 5, offset: 5 });
  rerender({ open: false });
  rerender({ open: true });
  await waitFor(() => expect(result.current.planned.loading).toBe(false));
  expect(result.current.planned.sprints).toHaveLength(10);
});

it("refreshes names in retained later pages when reopening the chooser", async () => {
  let renamed = false;
  transport((request) => {
    const data = page(request);
    if (renamed) {
      const sprint = data.sprints.nodes.find((node) => node.name === "Sprint 7");
      if (sprint) sprint.name = "Renamed externally";
    }
    return data;
  });
  const { result, rerender } = renderHook(({ open }) => useStorySprintHistory("renamed-history-project", "", open), {
    initialProps: { open: true },
  });
  await waitFor(() => expect(result.current.planned.sprints).toHaveLength(5));
  await act(async () => { await result.current.planned.loadMore(); });
  rerender({ open: false });
  renamed = true;
  rerender({ open: true });
  await waitFor(() => expect(result.current.planned.loading).toBe(false));
  expect(result.current.planned.sprints).toHaveLength(10);
  expect(result.current.planned.sprints[7]?.name).toBe("Renamed externally");
  expect(result.current.planned.total).toBe(14);
});

it("replaces later-page membership across every retained page even when the first page and total are unchanged", async () => {
  let changed = false;
  transport((request) => {
    const data = page(request);
    if (changed && request.variables.pagination.offset.offset > 0) {
      data.sprints.nodes.reverse();
      const sprint = data.sprints.nodes.find((node) => node.name === "Sprint 7");
      if (sprint) { sprint.id = "replacement-sprint"; sprint.name = "Replacement sprint"; }
    }
    return data;
  });
  const { result, rerender } = renderHook(({ open }) => useStorySprintHistory("membership-history-project", "", open), {
    initialProps: { open: true },
  });
  await waitFor(() => expect(result.current.planned.sprints).toHaveLength(5));
  await act(async () => { await result.current.planned.loadMore(); });
  await act(async () => { await result.current.planned.loadMore(); });
  expect(result.current.planned.sprints).toHaveLength(14);
  rerender({ open: false });
  changed = true;
  rerender({ open: true });
  await waitFor(() => expect(result.current.planned.loading).toBe(false));
  expect(result.current.planned.sprints.map((sprint) => sprint.name)).toEqual([
    "Sprint 0", "Sprint 1", "Sprint 2", "Sprint 3", "Sprint 4",
    "Sprint 9", "Sprint 8", "Replacement sprint", "Sprint 6", "Sprint 5",
    "Sprint 13", "Sprint 12", "Sprint 11", "Sprint 10",
  ]);
  expect(result.current.planned.total).toBe(14);
  expect(result.current.planned.hasMore).toBe(false);
});

it("keeps all retained choices while a later-page reopen refresh loads or fails and retries the complete refresh", async () => {
  let refresh = false;
  let fail = true;
  let release: (() => void) | undefined;
  const requests = transport(async (request) => {
    if (refresh && request.variables.filters.status.eq === "planned" && request.variables.pagination.offset.offset === 5 && fail) {
      await new Promise<void>((resolve) => { release = resolve; });
      throw new Error("Later page unavailable");
    }
    const data = page(request);
    if (refresh) {
      for (const sprint of data.sprints.nodes) sprint.name = `Updated ${sprint.name}`;
    }
    return data;
  });
  const { result, rerender } = renderHook(({ open }) => useStorySprintHistory("tail-retry-history-project", "", open), {
    initialProps: { open: true },
  });
  await waitFor(() => expect(result.current.planned.sprints).toHaveLength(5));
  await act(async () => { await result.current.planned.loadMore(); });
  rerender({ open: false });
  refresh = true;
  rerender({ open: true });
  await waitFor(() => expect(release).toBeDefined());
  expect(result.current.planned.loading).toBe(true);
  expect(result.current.planned.sprints).toHaveLength(10);
  expect(result.current.planned.sprints[0]?.name).toBe("Sprint 0");
  expect(result.current.planned.sprints[7]?.name).toBe("Sprint 7");
  await act(async () => { release?.(); });
  await waitFor(() => expect(result.current.planned.error?.message).toContain("Later page unavailable"));
  expect(result.current.planned.sprints).toHaveLength(10);
  expect(result.current.planned.sprints[0]?.name).toBe("Sprint 0");
  fail = false;
  await act(async () => { await result.current.planned.retry(); });
  expect(result.current.planned.error).toBeUndefined();
  expect(result.current.planned.sprints).toHaveLength(10);
  expect(result.current.planned.sprints[0]?.name).toBe("Updated Sprint 0");
  expect(result.current.planned.sprints[7]?.name).toBe("Updated Sprint 7");
  await act(async () => { await result.current.planned.loadMore(); });
  expect(result.current.planned.sprints).toHaveLength(14);
  expect(requests.at(-1)?.variables.pagination.offset.offset).toBe(10);
});

it.each(["reopen", "project and search change"])("rejects an obsolete retained-page refresh after %s", async (change) => {
  const projectId = `late-tail-${change}`;
  let phase = "initial";
  let release: (() => void) | undefined;
  transport(async (request) => {
    const data = page(request);
    if (phase !== "initial") {
      for (const sprint of data.sprints.nodes) sprint.name = `${phase} ${sprint.name}`;
    }
    if (phase === "obsolete" && request.variables.filters.status.eq === "planned"
      && request.variables.pagination.offset.offset === 5) {
      await new Promise<void>((resolve) => { release = resolve; });
    }
    return data;
  });
  const { result, rerender } = renderHook(({ project, search, open }) => useStorySprintHistory(project, search, open), {
    initialProps: { project: projectId, search: "", open: true },
  });
  await waitFor(() => expect(result.current.planned.sprints).toHaveLength(5));
  await act(async () => { await result.current.planned.loadMore(); });
  rerender({ project: projectId, search: "", open: false });
  phase = "obsolete";
  rerender({ project: projectId, search: "", open: true });
  await waitFor(() => expect(release).toBeDefined());
  phase = "fresh";
  if (change === "reopen") {
    rerender({ project: projectId, search: "", open: false });
  } else {
    rerender({ project: `${projectId}-other`, search: "Release", open: true });
    await waitFor(() => expect(result.current.planned.sprints[0]?.name).toBe("fresh Sprint 0"));
  }
  rerender({ project: projectId, search: "", open: true });
  await waitFor(() => expect(result.current.planned.loading).toBe(false));
  if (change !== "reopen") {
    expect(result.current.planned.sprints).toHaveLength(5);
    await act(async () => { await result.current.planned.loadMore(); });
  }
  expect(result.current.planned.sprints).toHaveLength(10);
  expect(result.current.planned.sprints[7]?.name).toBe("fresh Sprint 7");
  await act(async () => { release?.(); });
  expect(result.current.planned.sprints[0]?.name).toBe("fresh Sprint 0");
  expect(result.current.planned.sprints[7]?.name).toBe("fresh Sprint 7");
  expect(result.current.planned.loading).toBe(false);
  expect(result.current.planned.error).toBeUndefined();
});

it("preserves choices on failed refresh and retries its original offset while suppressing duplicate pages", async () => {
  let fail = false;
  let deliver: (() => void) | undefined;
  const requests = transport(async (request) => {
    if (request.variables.filters.status.eq === "planned") {
      if (fail) throw new Error("Temporary outage");
      if (request.variables.pagination.offset.offset === 5) await new Promise<void>((resolve) => { deliver = resolve; });
    }
    return page(request);
  });
  const { result } = renderHook(() => useStorySprintHistory("retry-project", "", true));
  await waitFor(() => expect(result.current.planned.sprints).toHaveLength(5));
  let loading!: Promise<void>;
  await act(async () => {
    loading = result.current.planned.loadMore();
    await result.current.planned.loadMore();
  });
  expect(requests.filter((r) => r.variables.filters.status.eq === "planned")).toHaveLength(2);
  await act(async () => { deliver?.(); await loading; });
  expect(result.current.planned.sprints).toHaveLength(10);
  fail = true;
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(result.current.planned.error?.message).toContain("Temporary outage"));
  expect(result.current.planned.sprints).toHaveLength(10);
  fail = false;
  await act(async () => { await result.current.planned.retry(); });
  expect(requests.at(-1)?.variables.pagination.offset.offset).toBe(0);
  expect(result.current.planned.sprints).toHaveLength(5);
  expect(result.current.planned.error).toBeUndefined();
});

it("invalidates a previously loaded project after lifecycle writes and resets it only on a successful page", async () => {
  let fail = false;
  transport((request) => {
    if (fail) throw new Error("Temporary outage");
    return page(request);
  });
  const { result, rerender } = renderHook(({ projectId }) => useStorySprintHistory(projectId, "", true), { initialProps: { projectId: "lifecycle-project" } });
  await waitFor(() => expect(result.current.planned.sprints).toHaveLength(5));
  await act(async () => { await result.current.planned.loadMore(); });
  rerender({ projectId: "other-lifecycle-project" });
  await waitFor(() => expect(result.current.planned.sprints).toHaveLength(5));
  act(() => refreshSprintChoices("lifecycle-project"));
  await waitFor(() => expect(result.current.planned.loading).toBe(false));
  fail = true;
  rerender({ projectId: "lifecycle-project" });
  await waitFor(() => expect(result.current.planned.error).toBeDefined());
  expect(result.current.planned.sprints).toHaveLength(10);
  fail = false;
  await act(async () => { await result.current.planned.retry(); });
  expect(result.current.planned.sprints).toHaveLength(5);
});

it("resets page cursors when a name search changes and when it clears back to a cached query", async () => {
  const requests = transport(page);
  const { result, rerender } = renderHook(({ search }) => useStorySprintHistory("search-reset-project", search, true), { initialProps: { search: "" } });
  await waitFor(() => expect(result.current.planned.sprints).toHaveLength(5));
  await act(async () => { await result.current.planned.loadMore(); });
  rerender({ search: "Release" });
  await waitFor(() => expect(result.current.planned.sprints).toHaveLength(5));
  rerender({ search: "" });
  await waitFor(() => expect(result.current.planned.loading).toBe(false));
  expect(result.current.planned.sprints).toHaveLength(5);
  await act(async () => { await result.current.planned.loadMore(); });
  expect(requests.at(-1)?.variables.pagination.offset.offset).toBe(5);
});

it("invalidates loaded membership on window focus while the chooser is closed", async () => {
  const requests = transport(page);
  const { result, rerender } = renderHook(({ open }) => useStorySprintHistory("closed-focus-project", "", open), { initialProps: { open: true } });
  await waitFor(() => expect(result.current.planned.sprints).toHaveLength(5));
  await act(async () => { await result.current.planned.loadMore(); });
  rerender({ open: false });
  const beforeFocus = requests.length;
  act(() => window.dispatchEvent(new Event("focus")));
  expect(requests).toHaveLength(beforeFocus);
  rerender({ open: true });
  await waitFor(() => expect(result.current.planned.loading).toBe(false));
  expect(result.current.planned.sprints).toHaveLength(5);
});

it("does not retain excess loaded history after a successful refresh reduces the collection total", async () => {
  let total = 14;
  transport((request) => page(request, total));
  const { result } = renderHook(() => useStorySprintHistory("deleted-history-project", "", true));
  await waitFor(() => expect(result.current.planned.sprints).toHaveLength(5));
  await act(async () => { await result.current.planned.loadMore(); });
  total = 7;
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(result.current.planned.total).toBe(7));
  expect(result.current.planned.sprints).toHaveLength(5);
  expect(result.current.planned.hasMore).toBe(true);
  await act(async () => { await result.current.planned.loadMore(); });
  expect(result.current.planned.sprints).toHaveLength(7);
  expect(result.current.planned.hasMore).toBe(false);
});

it("rejects late pages across project and search scopes, including returning to an in-flight project", async () => {
  const pending: { request: Request; deliver: (data: unknown) => void }[] = [];
  const requests = transport((request) => new Promise((resolve) => { pending.push({ request, deliver: resolve }); }));
  const { result, rerender } = renderHook(({ projectId, search }) => useStorySprintHistory(projectId, search, true), {
    initialProps: { projectId: "late-a", search: "" },
  });
  await waitFor(() => expect(pending).toHaveLength(2));
  rerender({ projectId: "late-b", search: "Release" });
  await waitFor(() => expect(pending).toHaveLength(4));
  expect(result.current.planned.sprints).toEqual([]);
  rerender({ projectId: "late-a", search: "" });
  await waitFor(() => expect(pending).toHaveLength(6));
  await act(async () => {
    for (const old of pending.slice(0, 4)) old.deliver(page(old.request));
  });
  expect(result.current.planned.sprints).toEqual([]);
  await act(async () => {
    for (const current of pending.slice(4)) current.deliver(page(current.request));
  });
  expect(result.current.planned.sprints[0]?.id).toBe("late-a-planned-0");
  expect(requests[2]?.variables.filters.name).toEqual({ contains: "Release" });
});
