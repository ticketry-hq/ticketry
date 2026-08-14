import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItem } from "./types";
import {
  createWorkItemBatcher,
  WorkItemNotFoundError,
  WORK_ITEM_BATCH_MAX_IDS,
  WORK_ITEM_BATCH_WINDOW_MS,
} from "./workItemBatcher";

const item = (id: string) => ({ id }) as unknown as WorkItem;

describe("deliberate architectural exception: work-item batcher invariants", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function releaseWindow(): Promise<void> {
    await vi.advanceTimersByTimeAsync(WORK_ITEM_BATCH_WINDOW_MS);
  }

  it("sends many ids requested inside one window as one call", async () => {
    const readBatch = vi.fn(async (ids: readonly string[]) => ids.map(item));
    const { fetchWorkItem } = createWorkItemBatcher(readBatch);
    const ids = Array.from({ length: 20 }, (_, index) => `item-${index}`);

    const reads = ids.map(fetchWorkItem);
    await releaseWindow();

    await expect(Promise.all(reads)).resolves.toEqual(ids.map(item));
    expect(readBatch).toHaveBeenCalledOnce();
    expect(readBatch).toHaveBeenCalledWith(ids);
  });

  it("splits a batch above the chunk limit without losing ids", async () => {
    const readBatch = vi.fn(async (ids: readonly string[]) => ids.map(item));
    const { fetchWorkItem } = createWorkItemBatcher(readBatch);
    const ids = Array.from({ length: 250 }, (_, index) => `item-${index}`);

    const reads = ids.map(fetchWorkItem);
    await releaseWindow();

    await expect(Promise.all(reads)).resolves.toHaveLength(ids.length);
    expect(readBatch).toHaveBeenCalledTimes(3);
    expect(readBatch.mock.calls.map(([chunk]) => chunk.length)).toEqual([
      WORK_ITEM_BATCH_MAX_IDS,
      WORK_ITEM_BATCH_MAX_IDS,
      50,
    ]);
    expect(readBatch.mock.calls.flatMap(([chunk]) => chunk)).toEqual(ids);
  });

  it("settles every caller when the same id is requested twice", async () => {
    const shared = item("shared");
    const readBatch = vi.fn(async () => [shared]);
    const { fetchWorkItem } = createWorkItemBatcher(readBatch);

    const first = fetchWorkItem(shared.id);
    const second = fetchWorkItem(shared.id);
    await releaseWindow();

    await expect(Promise.all([first, second])).resolves.toEqual([shared, shared]);
    expect(readBatch).toHaveBeenCalledOnce();
    expect(readBatch).toHaveBeenCalledWith([shared.id]);
  });

  it("rejects only an id missing from the reply", async () => {
    const present = item("present");
    const readBatch = vi.fn(async () => [present]);
    const { fetchWorkItem } = createWorkItemBatcher(readBatch);

    const reads = [fetchWorkItem(present.id), fetchWorkItem("missing")];
    const settled = Promise.allSettled(reads);
    await releaseWindow();
    const [found, missing] = await settled;

    expect(found).toEqual({ status: "fulfilled", value: present });
    expect(missing.status).toBe("rejected");
    if (missing.status === "rejected") {
      expect(missing.reason).toBeInstanceOf(WorkItemNotFoundError);
      expect(missing.reason).toMatchObject({ workItemId: "missing" });
    }
  });

  it("rejects each id separately when its batch call fails", async () => {
    const transportError = new Error("offline");
    const readBatch = vi.fn(async () => {
      throw transportError;
    });
    const { fetchWorkItem } = createWorkItemBatcher(readBatch);

    const reads = [fetchWorkItem("one"), fetchWorkItem("two")];
    const settled = Promise.allSettled(reads);
    await releaseWindow();
    const results = await settled;

    expect(results).toEqual([
      { status: "rejected", reason: transportError },
      { status: "rejected", reason: transportError },
    ]);
  });
});
