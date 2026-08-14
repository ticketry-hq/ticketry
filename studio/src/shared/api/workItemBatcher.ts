import type { WorkItem } from "./types";
import { listWorkItemsByIds } from "./client";

export const WORK_ITEM_BATCH_WINDOW_MS = 10;
export const WORK_ITEM_BATCH_MAX_IDS = 100;

type BatchRead = (ids: readonly string[]) => Promise<WorkItem[]>;

interface PendingRead {
  resolve: (item: WorkItem) => void;
  reject: (error: unknown) => void;
}

export class WorkItemNotFoundError extends Error {
  readonly workItemId: string;

  constructor(workItemId: string) {
    super(`Work item ${workItemId} was absent from the batch response.`);
    this.name = "WorkItemNotFoundError";
    this.workItemId = workItemId;
  }
}

export interface WorkItemBatcher {
  fetchWorkItem: (id: string) => Promise<WorkItem>;
}

export function createWorkItemBatcher(
  readBatch: BatchRead,
  options: { windowMs?: number; maxIds?: number } = {},
): WorkItemBatcher {
  const windowMs = options.windowMs ?? WORK_ITEM_BATCH_WINDOW_MS;
  const maxIds = options.maxIds ?? WORK_ITEM_BATCH_MAX_IDS;
  if (!Number.isInteger(maxIds) || maxIds < 1) {
    throw new RangeError("The work-item batch size must be a positive integer.");
  }
  if (!Number.isFinite(windowMs) || windowMs < 0) {
    throw new RangeError("The work-item batch window must be non-negative.");
  }

  const pending = new Map<string, PendingRead[]>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush(): Promise<void> {
    timer = null;
    const batch = new Map(pending);
    pending.clear();
    const ids = [...batch.keys()];

    for (let offset = 0; offset < ids.length; offset += maxIds) {
      const chunk = ids.slice(offset, offset + maxIds);
      try {
        const items = await readBatch(chunk);
        const itemsById = new Map(items.map((item) => [item.id, item]));
        for (const id of chunk) {
          const item = itemsById.get(id);
          for (const waiter of batch.get(id) ?? []) {
            if (item) waiter.resolve(item);
            else waiter.reject(new WorkItemNotFoundError(id));
          }
        }
      } catch (error) {
        for (const id of chunk) {
          for (const waiter of batch.get(id) ?? []) waiter.reject(error);
        }
      }
    }
  }

  function fetchWorkItem(id: string): Promise<WorkItem> {
    return new Promise((resolve, reject) => {
      const waiters = pending.get(id);
      if (waiters) waiters.push({ resolve, reject });
      else pending.set(id, [{ resolve, reject }]);
      timer ??= setTimeout(() => void flush(), windowMs);
    });
  }

  return { fetchWorkItem };
}

const defaultBatcher = createWorkItemBatcher(listWorkItemsByIds);

export const fetchWorkItem = defaultBatcher.fetchWorkItem;
