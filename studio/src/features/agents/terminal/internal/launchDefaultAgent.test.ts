import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetStudioApolloClient } from "../../../../shared/apollo/client";
import {
  deferWorktreeTrust,
  isWorktreeTrustDeferred,
} from "../../worktrees/worktreeTrustDeferrals";
import { launchDefaultAgent } from "./launchDefaultAgent";
import { createDefaultInteractiveTaskLaunch } from "./mutationTransport";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauri);
vi.mock("./mutationTransport", () => ({
  createDefaultInteractiveTaskLaunch: vi.fn(),
}));

const TASK = "task-with-deferred-trust";
const PATH = "/checkouts/task-with-deferred-trust";

describe("default agent launch worktree trust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deferWorktreeTrust(TASK, PATH);
  });

  afterEach(async () => resetStudioApolloClient());

  it("resumes trust requests when a desktop execution starts", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockResolvedValue({ agent_run_id: "run-1" });

    await launchDefaultAgent(TASK);

    expect(isWorktreeTrustDeferred(TASK, PATH)).toBe(false);
    expect(tauri.invoke).toHaveBeenCalledWith(
      "desktop_launch_default_coding_agent",
      { issueId: TASK },
    );
  });

  it("resumes trust requests when a browser execution starts", async () => {
    tauri.isTauri.mockReturnValue(false);
    vi.mocked(createDefaultInteractiveTaskLaunch).mockResolvedValue({
      agent_run_id: "run-1",
    });

    await launchDefaultAgent(TASK, {
      projectId: "project-1",
      moduleId: "module-1",
    });

    expect(isWorktreeTrustDeferred(TASK, PATH)).toBe(false);
  });
});
