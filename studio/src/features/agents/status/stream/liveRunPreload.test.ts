/**
 * The preload exists so the badges have data before the shell's first render.
 * What has to hold is that its rows land in the same holding the subscription
 * writes — not in a second store, and not in a shape the selectors cannot read.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { resetStudioApolloClient } from "../../../../shared/apollo/client";
import { installDesktopGraphQlRuntime } from "../../../../test/desktopGraphQlRuntime";
import { readAgentStatusHolding } from "../apolloHolding";
import { preloadLiveRunStatus } from "./liveRunPreload";

const PROJECT = "11111111-1111-1111-1111-111111111111";

const HOLDING = {
  agent_run_id: "run-1",
  project_id: PROJECT,
  task_id: "task-1",
  module_id: "module-1",
  agent: "codex",
  scope: "task",
  launch_state: "Implement",
  launch_model: "gpt-5",
  started_at: "2026-09-06T08:00:00Z",
  state: "working",
  effective_state: "working",
  updated_at: "2026-09-06T08:01:00Z",
  provider_session_id: null,
  output_sequence: 3,
  last_output_at: "2026-09-06T08:01:00Z",
};

const ATTEMPT = {
  attempt_id: "attempt-1",
  root_attempt_id: "attempt-1",
  retry_of_attempt_id: null,
  work_item_id: "task-1",
  status: "failed",
  error: "boom",
  failure: null,
  retryable: true,
  agent_run_id: "run-1",
  delivery_mode: null,
  updated_at: "2026-09-06T08:01:00Z",
};

describe("live run preload", () => {
  beforeEach(async () => {
    await resetStudioApolloClient();
  });

  it("seeds the holding the badges read", async () => {
    installDesktopGraphQlRuntime((async () => ({
      agent_run_holdings: [HOLDING],
      automation_attempts: [ATTEMPT],
    })) as never);

    await preloadLiveRunStatus(PROJECT);

    const holding = readAgentStatusHolding();
    expect(holding.projectId).toBe(PROJECT);
    expect(holding.runs["run-1"]).toMatchObject({
      module_id: "module-1",
      state: "working",
      effective_state: "working",
    });
    expect(holding.automationAttempts["attempt-1"]).toMatchObject({
      status: "failed",
      retryable: true,
    });
  });

  it("leaves the holding to the subscription when the read fails", async () => {
    installDesktopGraphQlRuntime((() => {
      throw new Error("offline");
    }) as never);

    await preloadLiveRunStatus(PROJECT);

    expect(readAgentStatusHolding().projectId).toBeNull();
  });
});
