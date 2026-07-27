import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>("../shared/api/client");
  return {
    ...actual,
    patchWorkItem: vi.fn(),
    deleteWorkItem: vi.fn(),
  };
});

import * as api from "../shared/api/client";
import { ApiError } from "../shared/api/client";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import type { State, WorkItem } from "../shared/api/types";

const patchWorkItem = api.patchWorkItem as ReturnType<typeof vi.fn>;
const deleteWorkItem = api.deleteWorkItem as ReturnType<typeof vi.fn>;

const TODO: State = { id: "st-todo", name: "Todo", group: "unstarted", color: null };
const DONE: State = { id: "st-done", name: "Done", group: "completed", color: null };

function wi(partial: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    name: partial.id,
    project_id: "p1",
    sequence_id: 1,
    state: null,
    assignees: [],
    labels: [],
    description_html: null,
    description_stripped: null,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    key: `MEML-${partial.id}`,
    ...partial,
  };
}

const store = () => useBacklogStore.getState();
const itemsById = () =>
  Object.fromEntries(store().items.map((i) => [i.id, i] as const));

beforeEach(() => {
  patchWorkItem.mockReset();
  deleteWorkItem.mockReset();
  useBacklogStore.setState({ items: [], states: [TODO, DONE], error: null });
});

describe("bulkSetState (#637)", () => {
  it("applies to all targets, reconciles fulfilled, rolls back only rejected", async () => {
    useBacklogStore.setState({
      items: [wi({ id: "a", state: TODO }), wi({ id: "b", state: TODO }), wi({ id: "c", state: TODO })],
    });
    patchWorkItem.mockImplementation(async (id: string) => {
      if (id === "b") throw new ApiError(422, "bad", {});
      return wi({ id, state: DONE, sub_issues_count: 7 });
    });

    const r = await store().bulkSetState(["a", "b", "c"], "st-done");

    expect(r).toEqual({ ok: 2, failed: 1 });
    const by = itemsById();
    expect(by.a.state?.id).toBe("st-done");
    expect(by.a.sub_issues_count).toBe(7); // server-reconciled
    expect(by.c.state?.id).toBe("st-done");
    expect(by.b.state?.id).toBe("st-todo"); // rolled back to snapshot
    expect(patchWorkItem).toHaveBeenCalledWith("a", {
      state_id: "st-done",
      force_if_completed: true,
    });
  });

  it("skips ids already at the target value (no request)", async () => {
    useBacklogStore.setState({
      items: [wi({ id: "a", state: DONE }), wi({ id: "b", state: TODO })],
    });
    patchWorkItem.mockResolvedValue(wi({ id: "b", state: DONE }));

    const r = await store().bulkSetState(["a", "b"], "st-done");

    expect(patchWorkItem).toHaveBeenCalledTimes(1);
    expect(patchWorkItem).toHaveBeenCalledWith("b", {
      state_id: "st-done",
      force_if_completed: true,
    });
    expect(r).toEqual({ ok: 1, failed: 0 });
  });

  it("applies optimistically before the requests settle", async () => {
    useBacklogStore.setState({ items: [wi({ id: "a", state: TODO }), wi({ id: "b", state: TODO })] });
    patchWorkItem.mockReturnValue(new Promise(() => {})); // never resolves
    void store().bulkSetState(["a", "b"], "st-done");
    expect(store().items.every((i) => i.state?.id === "st-done")).toBe(true);
  });
});

describe("bulkDelete (#637)", () => {
  it("removes all optimistically, restores 409 rows, reports deleted vs skipped", async () => {
    useBacklogStore.setState({
      items: [wi({ id: "a" }), wi({ id: "b" }), wi({ id: "c" })],
    });
    deleteWorkItem.mockImplementation(async (id: string) => {
      if (id === "b") throw new ApiError(409, "has children", {});
      return null;
    });

    const r = await store().bulkDelete(["a", "b", "c"]);

    expect(r.deleted).toBe(2);
    expect(r.skipped).toEqual(["b"]);
    expect(store().items.map((i) => i.id)).toEqual(["b"]); // a,c gone; b restored
  });

  it("no-ops for ids not in the store", async () => {
    useBacklogStore.setState({ items: [wi({ id: "a" })] });
    const r = await store().bulkDelete(["ghost"]);
    expect(r).toEqual({ deleted: 0, skipped: [] });
    expect(deleteWorkItem).not.toHaveBeenCalled();
    expect(store().items.map((i) => i.id)).toEqual(["a"]);
  });
});
