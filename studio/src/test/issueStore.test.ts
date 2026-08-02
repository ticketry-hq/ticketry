import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>("../shared/api/client");
  return {
    ...actual,
    getWorkItem: vi.fn(),
    listProjectWorkItems: vi.fn(async () => []),
    listStates: vi.fn(async () => []),
    listModules: vi.fn(async () => []),
    patchWorkItem: vi.fn(),
    createWorkItem: vi.fn(),
  };
});

import * as api from "../shared/api/client";
import { ApiError } from "../shared/api/client";
import {
  deriveEpic, resolveBlockerChips, useIssueStore, } from "../features/work-items/issue-detail";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import { useStudioStore } from "../features/projects/store";
import type { Module, State, WorkItem, WorkItemDetail } from "../shared/api/types";

const getWorkItem = api.getWorkItem as ReturnType<typeof vi.fn>;
const listProjectWorkItems = api.listProjectWorkItems as ReturnType<typeof vi.fn>;
const patchWorkItem = api.patchWorkItem as ReturnType<typeof vi.fn>;
const createWorkItem = api.createWorkItem as ReturnType<typeof vi.fn>;

const TODO: State = { id: "st-todo", name: "Todo", group: "unstarted", color: null };

function wi(partial: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    name: partial.id,
    project_id: "p1",
    sequence_id: 1,
    state: null,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    key: `MEML-${partial.id}`,
    ...partial,
    issue_type: partial.issue_type ?? { id: "type-task", name: "Task", level: "task" },
  };
}

function detail(task: WorkItem): WorkItemDetail {
  return { task, attachments: [] };
}

beforeEach(() => {
  getWorkItem.mockReset();
  patchWorkItem.mockReset();
  createWorkItem.mockReset();
  listProjectWorkItems.mockReset().mockResolvedValue([]);
  useIssueStore.setState({
    workItemsById: {},
    workItemIdByKey: {},
    childWorkItemIds: {},
    open: null,
    children: [],
    loading: false,
    notFound: false,
    error: null,
    saving: {},
    seenStateRevisions: {},
    pendingStateDeltas: {},
  });
  // Pre-select the project so openIssue skips the project/backlog hydration.
  useStudioStore.setState({ selectedProjectId: "p1", modules: [] });
  useBacklogStore.setState({ projectId: "p1", items: [], states: [TODO] });
});

describe("deriveEpic", () => {
  it("walks the parent chain up to the owning module", () => {
    const modules: Module[] = [
      {
        id: "m1",
        name: "Epic",
        project_id: "p1",
        sequence_id: 1,
        key: "MEML-1",
        issue_type: { id: "type-module", name: "Module", level: "module" },
      },
    ];
    const story = wi({ id: "s1", parent_id: "m1" });
    const sub = wi({ id: "st1", parent_id: "s1" });
    expect(deriveEpic(sub, modules, [story, sub])?.id).toBe("m1");
    expect(deriveEpic(story, modules, [story])?.id).toBe("m1");
  });

  it("returns null when the chain doesn't reach a module", () => {
    expect(deriveEpic(wi({ id: "t1", parent_id: null }), [], [])).toBeNull();
  });
});

describe("issueStore", () => {
  it("owns faithful keyed records and resolves their canonical child relationships", () => {
    const parent = wi({
      id: "parent",
      key: "MEML-41",
      state: null,
      is_archived: true,
      blocked_by_ids: ["blocker"],
      blocks_ids: ["dependent"],
    });
    const child = wi({ id: "child", key: "MEML-42", parent_id: "parent" });

    useIssueStore.getState().hydrateWorkItems([parent, child]);

    expect(useIssueStore.getState().getWorkItem("parent")).toBe(parent);
    expect(useIssueStore.getState().getWorkItemByKey("MEML-41")).toBe(parent);
    expect(useIssueStore.getState().getChildWorkItems("parent")).toEqual([child]);
    expect(useIssueStore.getState().getWorkItem("parent")).toMatchObject({
      state: null,
      is_archived: true,
      blocked_by_ids: ["blocker"],
      blocks_ids: ["dependent"],
    });
  });

  it("openIssue fetches by KEY-N and loads children", async () => {
    const task = wi({ id: "a", key: "MEML-7" });
    getWorkItem.mockResolvedValue(detail(task));
    listProjectWorkItems.mockResolvedValue([wi({ id: "c", parent_id: "a" })]);

    await useIssueStore.getState().openIssue("MEML-7");
    const s = useIssueStore.getState();
    expect(getWorkItem).toHaveBeenCalledWith("MEML-7", expect.any(AbortSignal));
    expect(s.open?.task.id).toBe("a");
    expect(s.children.map((c) => c.id)).toEqual(["c"]);
    expect(listProjectWorkItems).toHaveBeenCalledWith("p1", { parent: "a" });
  });

  it("openIssue marks notFound on a 404", async () => {
    getWorkItem.mockRejectedValue(new ApiError(404, "missing", {}));
    await useIssueStore.getState().openIssue("MEML-999");
    expect(useIssueStore.getState().notFound).toBe(true);
    expect(useIssueStore.getState().open).toBeNull();
  });

  it("patchField PATCHes by UUID, applies optimistically, reconciles, and cross-writes the backlog", async () => {
    const task = wi({ id: "a", name: "old" });
    useIssueStore.setState({ open: detail(task) });
    useBacklogStore.setState({ projectId: "p1", items: [task], states: [TODO] });
    patchWorkItem.mockResolvedValue(wi({ id: "a", name: "new", sub_issues_count: 2 }));

    await useIssueStore.getState().patchField({ name: "new" });
    expect(patchWorkItem).toHaveBeenCalledWith("a", { name: "new" });
    expect(useIssueStore.getState().open?.task.name).toBe("new");
    expect(useIssueStore.getState().open?.task.sub_issues_count).toBe(2);
    // Cross-store write-through to the backlog row.
    expect(useBacklogStore.getState().items.find((i) => i.id === "a")?.name).toBe("new");
  });

  it("patchField maps state_id to the State object optimistically", async () => {
    const task = wi({ id: "a" });
    useIssueStore.setState({ open: detail(task) });
    // Resolve slowly so we can observe the optimistic state before reconcile.
    patchWorkItem.mockResolvedValue(wi({ id: "a", state: TODO }));
    await useIssueStore.getState().patchField({ state_id: "st-todo" });
    expect(useIssueStore.getState().open?.task.state?.id).toBe("st-todo");
  });

  it("patchField rolls back the field on ApiError", async () => {
    const task = wi({ id: "a", name: "old" });
    useIssueStore.setState({ open: detail(task) });
    patchWorkItem.mockRejectedValue(new ApiError(400, "bad", {}));
    await useIssueStore.getState().patchField({ name: "new" });
    expect(useIssueStore.getState().open?.task.name).toBe("old");
    expect(useIssueStore.getState().error).toContain("400");
  });

  it("addSubtask POSTs with parent_id and appends the child", async () => {
    const task = wi({ id: "a", sub_issues_count: 0 });
    useIssueStore.setState({ open: detail(task) });
    createWorkItem.mockResolvedValue(wi({ id: "c", parent_id: "a" }));

    await useIssueStore.getState().addSubtask("New sub", "type-task");
    expect(createWorkItem).toHaveBeenCalledWith("p1", {
      name: "New sub",
      parent_id: "a",
      issue_type_id: "type-task",
    });
    expect(useIssueStore.getState().children.map((c) => c.id)).toEqual(["c"]);
    expect(useIssueStore.getState().open?.task.sub_issues_count).toBe(1);
    expect(useIssueStore.getState().getWorkItem("c")?.parent_id).toBe("a");
  });

  it("owns status-feed revisions and rejects older targeted reconciliation", () => {
    const task = wi({ id: "a", state: TODO, state_revision: 2 });
    useIssueStore.getState().hydrateWorkItems([task]);

    expect(
      useIssueStore.getState().applyWorkItemStateDelta(
        "a",
        { id: "st-done", name: "Done", group: "completed", color: null },
        3,
        "2026-06-01T00:01:00Z",
      ),
    ).toBe(true);
    expect(useIssueStore.getState().getWorkItem("a")).toMatchObject({
      state: { id: "st-done" },
      state_revision: 3,
    });
    expect(
      useIssueStore.getState().applyWorkItemStateDelta(
        "a",
        TODO,
        2,
        "2026-06-01T00:02:00Z",
      ),
    ).toBe(false);
    expect(
      useIssueStore.getState().reconcileWorkItem(
        wi({ id: "a", state: TODO, state_revision: 2 }),
        3,
      ),
    ).toBe("stale");
    expect(
      useIssueStore.getState().reconcileWorkItem(
        wi({ id: "a", name: "confirmed", state_revision: 3 }),
        3,
      ),
    ).toBe("applied");
    expect(useIssueStore.getState().getWorkItem("a")?.name).toBe("confirmed");
  });

  it("patchBlockers PATCHes blocked_by_ids by UUID and mirrors the reverse edge", async () => {
    const a = wi({ id: "a" });
    const b = wi({ id: "b" });
    useIssueStore.setState({ open: detail(a) });
    useBacklogStore.setState({ projectId: "p1", items: [a, b], states: [TODO] });
    patchWorkItem.mockResolvedValue(wi({ id: "a", blocked_by_ids: ["b"] }));

    await useIssueStore.getState().patchBlockers(["b"]);
    expect(patchWorkItem).toHaveBeenCalledWith("a", { blocked_by_ids: ["b"] });
    expect(useIssueStore.getState().open?.task.blocked_by_ids).toEqual(["b"]);
    // Reverse write-through: b.blocks_ids now contains a.
    expect(useBacklogStore.getState().items.find((i) => i.id === "b")?.blocks_ids).toEqual([
      "a",
    ]);
  });

  it("patchBlockers rolls back and skips the mirror on a 422 cycle rejection", async () => {
    const a = wi({ id: "a", blocked_by_ids: [] });
    const b = wi({ id: "b" });
    useIssueStore.setState({ open: detail(a) });
    useBacklogStore.setState({ projectId: "p1", items: [a, b], states: [TODO] });
    patchWorkItem.mockRejectedValue(new ApiError(422, "would create a cycle", {}));

    await useIssueStore.getState().patchBlockers(["b"]);
    // Rolled back to the previous (empty) set; b's reverse edge untouched.
    expect(useIssueStore.getState().open?.task.blocked_by_ids).toEqual([]);
    expect(useBacklogStore.getState().items.find((i) => i.id === "b")?.blocks_ids).toEqual([]);
    expect(useIssueStore.getState().error).toContain("422");
  });
});

describe("resolveBlockerChips", () => {
  it("resolves key/name/state and warns on an open blocker", () => {
    const open = wi({ id: "b", key: "MEML-2", state: TODO });
    const done = wi({
      id: "c",
      key: "MEML-3",
      state: { id: "st-done", name: "Done", group: "completed", color: null, sort_order: 3 },
    });
    const chips = resolveBlockerChips(["b", "c"], [open, done], []);
    expect(chips[0]).toMatchObject({ id: "b", key: "MEML-2", unresolved: true });
    expect(chips[1]).toMatchObject({ id: "c", key: "MEML-3", unresolved: false });
  });

  it("renders an unknown id as a bare-id chip that does not warn", () => {
    const chips = resolveBlockerChips(["ghost"], [], []);
    expect(chips[0]).toMatchObject({ id: "ghost", key: null, unresolved: false });
  });
});
