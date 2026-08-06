import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItem } from "../../shared/api/types";
import { fetchWorkItem } from "../../shared/api/workItemBatcher";
import { FIVE_MINUTES, queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { workItemQuery } from "./queries";

vi.mock("../../shared/api/workItemBatcher", () => ({
  fetchWorkItem: vi.fn(),
}));

describe("workItemQuery", () => {
  beforeEach(() => vi.mocked(fetchWorkItem).mockReset());

  it("reads its id through the batcher under the id-owned key", async () => {
    const record = { id: "item-1" } as unknown as WorkItem;
    vi.mocked(fetchWorkItem).mockResolvedValue(record);

    const options = workItemQuery(record.id);

    expect(options.queryKey).toEqual(queryKeys.workItems.byId(record.id));
    expect(options.staleTime).toBe(FIVE_MINUTES);
    await expect(options.queryFn()).resolves.toBe(record);
    expect(fetchWorkItem).toHaveBeenCalledWith(record.id);
  });

  it("uses an ordinary global freshness policy without focus refetching", () => {
    const defaults = queryClient.getDefaultOptions().queries;

    expect(defaults?.staleTime).toBe(FIVE_MINUTES);
    expect(defaults?.staleTime).not.toBe(Infinity);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
  });
});
