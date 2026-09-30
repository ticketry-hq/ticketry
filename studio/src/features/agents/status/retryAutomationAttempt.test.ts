import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../shared/api/errors";
import { initializeStudioRuntime } from "../../../runtime";
import { createDesktopRuntime } from "../../../runtime/desktopRuntime";
import { retryAutomationAttempt } from "./retryAutomationAttempt";
import { useAgentStatusStore } from "./testStore";

const ATTEMPT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const RETRY = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TASK = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PROJECT = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const RETRY_PAYLOAD = {
  attempt_id: RETRY,
  root_attempt_id: ATTEMPT,
  retry_of_attempt_id: ATTEMPT,
  work_item_id: TASK,
  status: "pending",
  error: null,
  failure: null,
  retryable: true,
  agent_run_id: null,
  updated_at: "2026-08-16T00:00:00Z",
};

async function useStatusRuntime(
  execute: (requestJson: string) => Promise<string>,
) {
  const graphqlExecute = vi.fn(execute);
  const invoke = vi.fn().mockResolvedValue({
    serviceHealth: {
      state: "ready",
      service: "backend",
      message: null,
      logPointer: null,
    },
    initialNotices: [],
  });
  initializeStudioRuntime(await createDesktopRuntime({
    invoke,
    createGraphQlProxy: () => ({
      graphql_execute: graphqlExecute,
      graphql_subscribe: vi.fn(),
      graphql_unsubscribe: vi.fn(),
    }),
  }));
  useAgentStatusStore.setState({
    projectId: PROJECT,
    runs: {},
    automationAttempts: {},
    automationByTask: {},
  });
  return graphqlExecute;
}

afterEach(() => {
  vi.restoreAllMocks();
  useAgentStatusStore.getState().reconcileAutomationAttempts([]);
});

describe("Automation Attempt retry", () => {
  it("commands the authored Rust retry over the status transport", async () => {
    const graphqlExecute = await useStatusRuntime(async () =>
      JSON.stringify({ data: { retry_automation_attempt: RETRY_PAYLOAD } }),
    );

    const attempt = await retryAutomationAttempt(ATTEMPT);

    const request = JSON.parse(graphqlExecute.mock.calls[0][0] as string);
    expect(request.operationName).toBe("RetryAutomationAttempt");
    expect(request.variables).toEqual({ attemptId: ATTEMPT });
    expect(attempt.attempt_id).toBe(RETRY);
    expect(attempt.retry_of_attempt_id).toBe(ATTEMPT);
    // The retry child is published to the holding immediately — under its
    // lineage's root, which is how the holding keys an attempt — so the
    // chicklet reports the pending retry without waiting for the stream.
    const held = useAgentStatusStore.getState().automationAttempts[ATTEMPT];
    expect(held?.attempt_id).toBe(RETRY);
    expect(held?.status).toBe("pending");
  });

  it("keeps the typed refusals Rust publishes at their REST-shaped status", async () => {
    const refusals = [
      ["automation_attempt_not_found", 404],
      ["automation_attempt_not_failed", 409],
      ["automation_attempt_not_retryable", 409],
    ] as const;
    for (const [code, status] of refusals) {
      await useStatusRuntime(async () =>
        JSON.stringify({
          data: null,
          errors: [{ message: `refused: ${code}`, extensions: { code } }],
        }),
      );

      const error = await retryAutomationAttempt(ATTEMPT).catch(
        (thrown: unknown) => thrown,
      );

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(status);
      expect((error as ApiError).body).toMatchObject({ code });
    }
  });
});
