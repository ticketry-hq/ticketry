import { describe, expect, it } from "vitest";

import {
  adaptWorktreeStatus,
  type WorktreeStatusPayload,
} from "./statusTransport";

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

describe("worktree status adaptation", () => {
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
