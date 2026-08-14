import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeBrowserRuntime } from "../../runtime";
import { listWorkItemsByIds } from "./client";

describe("work-item batch API", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    initializeBrowserRuntime();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("posts one hundred ids to the canonical batch endpoint", async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `item-${index}`);

    await expect(listWorkItemsByIds(ids)).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/work-tracker/work-items/batch");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ ids });
  });
});
