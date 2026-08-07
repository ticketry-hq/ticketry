import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { getTasks } from "../../shared/api/client";
import type { IssueType, State, WorkItem } from "../../shared/api/types";
import { fetchWorkItem } from "../../shared/api/workItemBatcher";
import { FIVE_MINUTES, queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { seedStates } from "../../shared/query/stateCatalog";
import { seedIssueTypes } from "../settings/queries";
import { orderedTaskSections } from "../studio/lib/taskTree";
import { loadModuleTree, workItemQuery } from "./queries";

vi.mock("../../shared/api/client", () => ({
  getTasks: vi.fn(),
}));

vi.mock("../../shared/api/workItemBatcher", () => ({
  fetchWorkItem: vi.fn(),
}));

describe("workItemQuery", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(fetchWorkItem).mockReset();
    vi.mocked(getTasks).mockReset();
  });

  it("reads its id through the batcher under the id-owned key", async () => {
    const record = workItem();
    vi.mocked(fetchWorkItem).mockResolvedValue(record);

    const options = workItemQuery(record.id);

    expect(options.queryKey).toEqual(queryKeys.workItems.byId(record.id));
    expect(options.staleTime).toBe(FIVE_MINUTES);
    await expect(options.queryFn()).resolves.toEqual(record);
    expect(fetchWorkItem).toHaveBeenCalledWith(record.id);
  });

  it("keeps mounted refetches normalized after a state change", async () => {
    const original = workItem();
    const review = state("review", "Review");
    seedStates(original.project_id, [original.state!, review]);
    seedIssueTypes(original.project_id, [original.issue_type]);
    vi.mocked(fetchWorkItem)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce({
        ...original,
        state: review.id,
        issue_type: original.issue_type.id,
      } as unknown as WorkItem);
    const { result } = renderHook(() =>
      useQuery(workItemQuery(original.id), queryClient),
    );
    await waitFor(() => expect(result.current.data?.state).toEqual(original.state));

    await queryClient.invalidateQueries({
      queryKey: queryKeys.workItems.byId(original.id),
      exact: true,
    });

    await waitFor(() => expect(result.current.data?.state).toEqual(review));
    expect(
      orderedTaskSections(
        [original.id],
        { [original.id]: result.current.data! },
        [original.state!, review],
      ).find((section) => section.state.id === review.id)?.ids,
    ).toEqual([original.id]);
    expect(fetchWorkItem).toHaveBeenCalledTimes(2);
  });

  it("uses an ordinary global freshness policy without focus refetching", () => {
    const defaults = queryClient.getDefaultOptions().queries;

    expect(defaults?.staleTime).toBe(FIVE_MINUTES);
    expect(defaults?.staleTime).not.toBe(Infinity);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
  });

  it("seeds normalized module records under their id-owned keys", async () => {
    const record = {
      id: "item-1",
      state: { id: "state-1", name: "Implement" },
    } as unknown as WorkItem;
    vi.mocked(getTasks).mockResolvedValue({
      rootIds: [record.id],
      children: { [record.id]: [] },
      order: [record.id],
      states: [],
      workItems: [record],
    });

    await loadModuleTree("project-1", "module-1");

    expect(queryClient.getQueryData(queryKeys.workItems.byId(record.id))).toBe(
      record,
    );
    expect(fetchWorkItem).not.toHaveBeenCalled();
  });

  it("does not let a membership refresh replace a newer or optimistic entry", async () => {
    const current = workItem();
    const stale = { ...current, name: "stale", state_revision: 1 };
    queryClient.setQueryData(queryKeys.workItems.byId(current.id), {
      ...current,
      name: "newer",
      state_revision: 3,
    });
    vi.mocked(getTasks).mockResolvedValue({
      rootIds: [current.id],
      children: { [current.id]: [] },
      order: [current.id],
      states: [],
      workItems: [stale],
    });

    await loadModuleTree("project-1", "module-1");
    expect(
      queryClient.getQueryData<WorkItem>(queryKeys.workItems.byId(current.id)),
    ).toMatchObject({ name: "newer", state_revision: 3 });

    queryClient.setQueryData(queryKeys.workItems.byId(current.id), {
      ...current,
      name: "optimistic",
    });
    const mutationSpy = vi.spyOn(queryClient, "isMutating").mockReturnValue(1);
    await loadModuleTree("project-1", "module-1");
    expect(
      queryClient.getQueryData<WorkItem>(queryKeys.workItems.byId(current.id)),
    ).toMatchObject({ name: "optimistic" });
    mutationSpy.mockRestore();
  });
});

const state = (id: string, name: string): State => ({
  id,
  name,
  group: "started",
  color: null,
  sort_order: 0,
});

const STORY: IssueType = {
  id: "story",
  name: "Story",
  level: "task",
  color: null,
  sort_order: 0,
};

function workItem(): WorkItem {
  return {
    id: "item-1",
    name: "Story",
    project_id: "project-1",
    sequence_id: 1,
    state: state("todo", "Todo"),
    state_revision: 1,
    description: "",
    parent_id: "module-1",
    sub_issues_count: 0,
    key: "PROJ-1",
    is_archived: false,
    created_at: "2026-08-07T00:00:00Z",
    updated_at: "2026-08-07T00:00:00Z",
    rank: "a",
    issue_type: STORY,
    blocked_by_ids: [],
    blocks_ids: [],
  };
}
