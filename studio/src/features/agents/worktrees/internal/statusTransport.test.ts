import { describe, expect, it, vi } from "vitest";

import { adaptWorktreeStatus, readWorktreeStatus } from "./statusTransport";
import type { WorktreeStatusPayload } from "../generated/worktreeStatus";
import { initializeStudioRuntime, type StudioRuntime } from "../../../../runtime";

const live: WorktreeStatusPayload = {
  kind: "worktree",
  task_id: "60000000-0000-0000-0000-000000000002",
  top_level_task_id: "60000000-0000-0000-0000-000000000001",
  is_shared: true,
  branch: "wt/CODIN-881-parent-story",
  base_branch: "main",
  path: "/checkouts/CODIN-881-parent-story",
  state: "active",
  clean: false,
  dirty: true,
  ahead: 2,
  behind: 1,
  conflict: false,
  checkout_present: true,
  ephemeral: false,
  reason: null,
};

function desktopRuntime(
  execute: StudioRuntime["readWorkTracker"],
): StudioRuntime {
  return {
    platform: "desktop",
    capabilities: {
      statusFeed: true,
      nativeLifecycle: false,
      serviceSupervision: true,
      nativeTerminal: false,
      nativeFolderPicker: true,
    },
    readWorkTracker: execute,
    writeWorkTracker: execute,
    readSettings: execute,
    writeSettings: execute,
    statusStream: () => null,
    documentUrl: (documentId: string, relPath: string) =>
      `/api/docs/${documentId}/${relPath}`,
    pickFolder: async () => null,
    retryServices: async () => {},
    startup: () => ({
      serviceHealth: {
        state: "ready",
        service: "backend",
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    }),
    subscribeServiceHealth: () => () => {},
    subscribeUserNotices: () => () => {},
  };
}

describe("worktree status transport", () => {
  it("asks the runtime for one identity and adapts the discriminated contract", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const execute = vi.fn(async (document, variables) => {
      expect(document.operationName).toBe("WorktreeStatus");
      expect(variables).toEqual({
        taskId: "60000000-0000-0000-0000-000000000002",
      });
      return { worktree_status: live };
    });
    initializeStudioRuntime(
      desktopRuntime((routes) => routes.graphQl(execute as never)),
    );

    const status = await readWorktreeStatus(
      "60000000-0000-0000-0000-000000000002",
      { parentId: "60000000-0000-0000-0000-000000000001", moduleId: "m1" },
    );

    expect(status.kind).toBe("worktree");
    expect(status.is_shared).toBe(true);
    expect(status.top_level_task_id).toBe(
      "60000000-0000-0000-0000-000000000001",
    );
    expect(status.dirty).toBe(true);
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(1);
    expect(status.checkout_present).toBe(true);
    // The desktop has one worktree authority; no host route is consulted.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps absence absent rather than filling in git facts", () => {
    const status = adaptWorktreeStatus({
      ...live,
      kind: "no_repo",
      is_shared: false,
      branch: null,
      base_branch: null,
      path: null,
      state: null,
      clean: null,
      dirty: null,
      ahead: null,
      behind: null,
      conflict: null,
      checkout_present: null,
      reason: "no local folder is configured for this module",
    });

    expect(status.kind).toBe("no_repo");
    expect(status.branch).toBeNull();
    expect(status.ahead).toBeNull();
    expect(status.checkout_present).toBeNull();
    expect(status.reason).toBe(
      "no local folder is configured for this module",
    );
  });
});
