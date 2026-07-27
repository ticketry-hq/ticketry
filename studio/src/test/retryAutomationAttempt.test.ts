import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationAttemptRecord } from "@worktracker/typescript-sdk";

const retry = vi.hoisted(() => vi.fn());
const createAgentStatusClient = vi.hoisted(() =>
  vi.fn(() => ({ retryAutomationAttempt: retry })),
);

vi.mock("@worktracker/typescript-sdk/agent-status", async (load) => ({
  ...(await load<typeof import("@worktracker/typescript-sdk/agent-status")>()),
  createAgentStatusClient,
}));

import { retryAutomationAttempt } from "../features/agents/status/retryAutomationAttempt";
import { useAgentStatusStore } from "../features/agents/status";

const succeeded: AutomationAttemptRecord = {
  attempt_id: "retry-1",
  root_attempt_id: "attempt-1",
  retry_of_attempt_id: "attempt-1",
  work_item_id: "task-1",
  status: "succeeded",
  error: null,
  agent_run_id: "run-1",
  updated_at: "2026-07-16T15:01:00Z",
};

beforeEach(() => {
  vi.unstubAllEnvs();
  retry.mockReset().mockResolvedValue(succeeded);
  createAgentStatusClient.mockClear();
  useAgentStatusStore.getState().switchProject("project-1");
});

describe("retryAutomationAttempt", () => {
  it("uses the default agent-runtime route and records the outcome", async () => {
    await expect(retryAutomationAttempt("attempt-1")).resolves.toEqual(succeeded);

    expect(createAgentStatusClient).toHaveBeenCalledWith({
      baseUrl: "/api",
      apiKey: "",
    });
    expect(retry).toHaveBeenCalledWith({ attemptId: "attempt-1" });
    expect(useAgentStatusStore.getState().automationAttempts["attempt-1"]).toEqual(
      succeeded,
    );
  });
});
