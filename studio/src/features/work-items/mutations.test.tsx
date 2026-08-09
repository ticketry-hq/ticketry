import type { PropsWithChildren } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../shared/api/client";
import type {
  IssueType,
  State,
  WorkItem,
} from "../../shared/api/types";
import { queryKeys } from "../../shared/query/keys";
import {
  useChangeWorkItemType,
  useCreateWorkItem,
  useEditWorkItemDescription,
  useRenameWorkItem,
  useReorderWorkItem,
  useSetWorkItemBlockers,
  useSetWorkItemParent,
  useSetWorkItemState,
} from "./mutations";

vi.mock("../../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../shared/api/client")>(
    "../../shared/api/client",
  );
  return {
    ...actual,
    createWorkItem: vi.fn(),
    patchWorkItem: vi.fn(),
    reorderWorkItem: vi.fn(),
  };
});

const TODO: State & { id: string } = {
  id: "todo",
  name: "Todo",
  group: "unstarted",
  color: null,
};
const REVIEW: State & { id: string } = {
  id: "review",
  name: "Review",
  group: "started",
  color: null,
};
const STORY: IssueType = {
  id: "story",
  name: "Story",
  level: "task",
  color: null,
  sort_order: 1,
};
const IMPLEMENTATION: IssueType = {
  id: "implementation",
  name: "Implementation",
  level: "task",
  color: null,
  sort_order: 2,
};

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "item",
    name: "Before",
    key: "MEML-1",
    project_id: "project",
    sequence_id: 1,
    state: TODO.id,
    issue_type: STORY.id,
    description: "Old description",
    parent_id: "module",
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    ...overrides,
  } as WorkItem;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function testClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("work-item optimistic mutations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("paints a rename immediately, keeps the baseline in mutation context, and rolls back a refusal", async () => {
    const client = testClient();
    const original = workItem();
    client.setQueryData(queryKeys.workItems.byId(original.id), original);
    const request = deferred<WorkItem>();
    vi.mocked(api.patchWorkItem).mockReturnValue(request.promise);
    const { result } = renderHook(() => useRenameWorkItem(), {
      wrapper: wrapper(client),
    });

    act(() => result.current.mutate({ id: original.id, name: "After" }));

    await waitFor(() =>
      expect(
        client.getQueryData<WorkItem>(queryKeys.workItems.byId(original.id))
          ?.name,
      ).toBe("After"),
    );
    expect(vi.mocked(api.patchWorkItem)).toHaveBeenCalledWith(original.id, {
      name: "After",
    });

    request.reject(new Error("refused"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      client.getQueryData<WorkItem>(queryKeys.workItems.byId(original.id)),
    ).toEqual(original);
  });

  it("optimistically updates description, issue type, and workflow state through the same lifecycle", async () => {
    const client = testClient();
    const original = workItem();
    client.setQueryData(queryKeys.workItems.byId(original.id), original);
    const requests = [deferred<WorkItem>(), deferred<WorkItem>(), deferred<WorkItem>()];
    vi.mocked(api.patchWorkItem)
      .mockReturnValueOnce(requests[0].promise)
      .mockReturnValueOnce(requests[1].promise)
      .mockReturnValueOnce(requests[2].promise);
    const { result } = renderHook(
      () => ({
        description: useEditWorkItemDescription(),
        issueType: useChangeWorkItemType(),
        state: useSetWorkItemState(),
      }),
      { wrapper: wrapper(client) },
    );

    act(() =>
      result.current.description.mutate({
        id: original.id,
        description: "New description",
      }),
    );
    await waitFor(() =>
      expect(
        client.getQueryData<WorkItem>(queryKeys.workItems.byId(original.id))
          ?.description,
      ).toBe("New description"),
    );
    requests[0].resolve(workItem({ description: "New description" }));
    await waitFor(() => expect(result.current.description.isSuccess).toBe(true));

    act(() =>
      result.current.issueType.mutate({
        id: original.id,
        issueType: IMPLEMENTATION,
      }),
    );
    await waitFor(() =>
      expect(
        client.getQueryData<WorkItem>(queryKeys.workItems.byId(original.id))
          ?.issue_type,
      ).toEqual(IMPLEMENTATION.id),
    );
    requests[1].resolve(workItem({ issue_type: IMPLEMENTATION.id }));
    await waitFor(() => expect(result.current.issueType.isSuccess).toBe(true));

    act(() =>
      result.current.state.mutate({ id: original.id, state: REVIEW }),
    );
    await waitFor(() =>
      expect(
        client.getQueryData<WorkItem>(queryKeys.workItems.byId(original.id))
          ?.state,
      ).toEqual(REVIEW.id),
    );
    requests[2].resolve(workItem({ state: REVIEW.id }));
    await waitFor(() => expect(result.current.state.isSuccess).toBe(true));
    expect(
      client.getQueryData<WorkItem>(queryKeys.workItems.byId(original.id))
        ?.state,
    ).toEqual(REVIEW.id);

    expect(vi.mocked(api.patchWorkItem).mock.calls).toEqual([
      [original.id, { description: "New description" }],
      [original.id, { issue_type_id: IMPLEMENTATION.id }],
      [original.id, { state_id: REVIEW.id }],
    ]);
  });

  it("reparents immediately and refreshes every affected membership", async () => {
    const client = testClient();
    const original = workItem();
    client.setQueryData(queryKeys.workItems.byId(original.id), original);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    vi.mocked(api.patchWorkItem).mockResolvedValue(
      workItem({ parent_id: "other-module" }),
    );
    const memberships = [
      { projectId: "project", moduleId: "module" },
      { projectId: "project", moduleId: "other-module" },
    ];
    const { result } = renderHook(
      () => useSetWorkItemParent(memberships),
      { wrapper: wrapper(client) },
    );

    act(() =>
      result.current.mutate({
        id: original.id,
        parentId: "other-module",
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      client.getQueryData<WorkItem>(queryKeys.workItems.byId(original.id))
        ?.parent_id,
    ).toBe("other-module");
    for (const membership of memberships) {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.tasks.byModule(
          membership.projectId,
          membership.moduleId,
        ),
        exact: true,
      });
    }
  });

  it("rolls blockers back and refreshes both old and proposed blocker records", async () => {
    const client = testClient();
    const original = workItem({ blocked_by_ids: ["old-blocker"] });
    client.setQueryData(queryKeys.workItems.byId(original.id), original);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    vi.mocked(api.patchWorkItem).mockRejectedValue(new Error("cycle"));
    const { result } = renderHook(() => useSetWorkItemBlockers(), {
      wrapper: wrapper(client),
    });

    act(() =>
      result.current.mutate({
        id: original.id,
        blockedByIds: ["new-blocker"],
      }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(
      client.getQueryData<WorkItem>(queryKeys.workItems.byId(original.id))
        ?.blocked_by_ids,
    ).toEqual(["old-blocker"]);
    for (const id of ["old-blocker", "new-blocker"]) {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.workItems.byId(id),
        exact: true,
      });
    }
  });

  it("sends neighbor ids, paints a provisional rank, and reconciles the server rank", async () => {
    const client = testClient();
    const moved = workItem({ id: "moved", rank: "z" });
    client.setQueryData(queryKeys.workItems.byId(moved.id), moved);
    client.setQueryData(
      queryKeys.workItems.byId("before"),
      workItem({ id: "before", rank: "F" }),
    );
    client.setQueryData(
      queryKeys.workItems.byId("after"),
      workItem({ id: "after", rank: "V" }),
    );
    const request = deferred<WorkItem>();
    vi.mocked(api.reorderWorkItem).mockReturnValue(request.promise);
    const { result } = renderHook(
      () =>
        useReorderWorkItem({ projectId: "project", moduleId: "module" }),
      { wrapper: wrapper(client) },
    );

    act(() =>
      result.current.mutate({
        id: moved.id,
        beforeId: "before",
        afterId: "after",
      }),
    );
    await waitFor(() => {
      const rank = client.getQueryData<WorkItem>(
        queryKeys.workItems.byId(moved.id),
      )?.rank;
      expect(rank! > "F" && rank! < "V").toBe(true);
    });
    expect(vi.mocked(api.reorderWorkItem)).toHaveBeenCalledWith(moved.id, {
      before_id: "before",
      after_id: "after",
    });

    request.resolve(workItem({ id: moved.id, rank: "M" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      client.getQueryData<WorkItem>(queryKeys.workItems.byId(moved.id))?.rank,
    ).toBe("M");
  });

  it("keeps creation pending without a temporary cache id and refreshes membership when it lands", async () => {
    const client = testClient();
    const request = deferred<WorkItem>();
    vi.mocked(api.createWorkItem).mockReturnValue(request.promise);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const membership = { projectId: "project", moduleId: "module" };
    const { result } = renderHook(() => useCreateWorkItem(membership), {
      wrapper: wrapper(client),
    });
    const body = {
      name: "New item",
      parent_id: "module",
      issue_type_id: "story",
    };

    act(() => result.current.mutate(body));
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(
      client
        .getQueryCache()
        .findAll()
        .filter((query) => query.queryKey[0] === "workItem"),
    ).toEqual([]);

    request.resolve(workItem({ id: "server-id", name: body.name }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      client.getQueryData(queryKeys.workItems.byId("server-id")),
    ).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.tasks.byModule("project", "module"),
      exact: true,
    });
  });
});
