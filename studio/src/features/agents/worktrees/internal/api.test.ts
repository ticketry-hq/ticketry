import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getWorktree } from "./api";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({
    kind: "none",
    task_id: "task-1",
    top_level_task_id: "task-1",
    is_shared: false,
  }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("worktree host authentication", () => {
  it("sends the runtime API key when reading worktree state", async () => {
    vi.stubEnv("VITE_WT_API_KEY", "desktop-worktree-secret");

    await getWorktree("task-1", {});

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/worktrees?task_id=task-1");
    expect(new Headers(init.headers).get("x-api-key")).toBe(
      "desktop-worktree-secret",
    );
  });
});
