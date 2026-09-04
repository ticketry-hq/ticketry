import { beforeEach, describe, expect, it } from "vitest";

import {
  readAgentStatusHolding,
  replaceAgentStatusHolding,
} from "./apolloHolding";
import { selectTaskAutomationDelivery } from "./automationDelivery";
import type { AgentStatusData, AutomationAttemptRecord } from "./types";

const PROJECT = "11111111-1111-1111-1111-111111111111";

function attempt(
  overrides: Partial<AutomationAttemptRecord> & {
    attempt_id: string;
    work_item_id: string;
  },
): AutomationAttemptRecord {
  return {
    root_attempt_id: overrides.attempt_id,
    retry_of_attempt_id: null,
    status: "pending",
    error: null,
    failure: null,
    retryable: false,
    delivery_mode: null,
    agent_run_id: null,
    updated_at: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

function holding(attempts: AutomationAttemptRecord[]): AgentStatusData {
  return {
    projectId: PROJECT,
    runs: {},
    automationAttempts: Object.fromEntries(
      attempts.map((row) => [row.root_attempt_id, row]),
    ),
    automationByTask: attempts.reduce<Record<string, string[]>>((byTask, row) => {
      byTask[row.work_item_id] = [
        ...(byTask[row.work_item_id] ?? []),
        row.root_attempt_id,
      ];
      return byTask;
    }, {}),
    stallEpoch: 0,
  };
}

beforeEach(() => {
  replaceAgentStatusHolding(holding([]));
});

describe("automation delivery", () => {
  it("keeps the delivery mode across the holding cache round trip", () => {
    replaceAgentStatusHolding(holding([
      attempt({
        attempt_id: "attempt-1",
        work_item_id: "story-1",
        delivery_mode: "continued",
      }),
    ]));

    expect(
      readAgentStatusHolding().automationAttempts["attempt-1"].delivery_mode,
    ).toBe("continued");
  });

  it("reports a continued handoff even after its attempt has succeeded", () => {
    // Typed delivery settles the attempt in the same breath, so the happy
    // continued path is only ever observable as a succeeded attempt.
    const state = holding([
      attempt({
        attempt_id: "attempt-1",
        work_item_id: "story-1",
        status: "succeeded",
        delivery_mode: "continued",
        agent_run_id: "run-1",
      }),
    ]);

    expect(selectTaskAutomationDelivery(state, "story-1")).toEqual({
      mode: "continued",
      attemptId: "attempt-1",
      at: "2026-09-01T12:00:00.000Z",
    });
  });

  it("distinguishes a fresh session from a continued one", () => {
    const state = holding([
      attempt({
        attempt_id: "attempt-1",
        work_item_id: "story-1",
        delivery_mode: "started_fresh",
      }),
    ]);

    expect(selectTaskAutomationDelivery(state, "story-1")?.mode)
      .toBe("started_fresh");
  });

  it("reports nothing until a transition has been delivered", () => {
    const state = holding([
      attempt({ attempt_id: "attempt-1", work_item_id: "story-1" }),
    ]);

    expect(selectTaskAutomationDelivery(state, "story-1")).toBeNull();
  });

  it("takes the newest delivery across the rolled-up subtree", () => {
    const state = holding([
      attempt({
        attempt_id: "attempt-1",
        work_item_id: "story-1",
        delivery_mode: "started_fresh",
        updated_at: "2026-09-01T12:00:00.000Z",
      }),
      attempt({
        attempt_id: "attempt-2",
        work_item_id: "child-1",
        delivery_mode: "continued",
        // The outbox spells its instants with an offset rather than `Z`; a
        // lexical comparison would rank this older one first.
        updated_at: "2026-09-01T14:00:00+00:00",
      }),
    ]);

    expect(selectTaskAutomationDelivery(state, "story-1", ["child-1"])?.mode)
      .toBe("continued");
  });

  it("leaves an unrelated Work Item's delivery alone", () => {
    const state = holding([
      attempt({
        attempt_id: "attempt-1",
        work_item_id: "other-story",
        delivery_mode: "continued",
      }),
    ]);

    expect(selectTaskAutomationDelivery(state, "story-1")).toBeNull();
  });
});
