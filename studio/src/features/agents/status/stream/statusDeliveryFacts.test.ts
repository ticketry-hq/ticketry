import { describe, expect, it } from "vitest";

import type { RunStatusEventFrame } from "../types";
import { readStatusFact } from "./statusFacts";

/**
 * Crossing a handoff edge publishes a delivery event rather than a new run:
 * nothing spawned, so the only durable evidence that the destination reached
 * an agent is the attempt's delivery mode.
 */
function delivery(mode: "continued" | "started_fresh"): RunStatusEventFrame {
  return {
    __typename: "RunStatusEvent",
    cursor: 42,
    event_id: `event-${mode}`,
    project_id: "project-1",
    event_kind: "automation_attempt_delivery",
    payload_version: 1,
    subject_kind: "automation_attempt",
    subject_id: "attempt-1",
    agent_run_id: "run-1",
    automation_attempt_id: "attempt-1",
    work_item_id: "story-1",
    payload: {
      attempt_id: "attempt-1",
      root_attempt_id: "attempt-1",
      retry_of_attempt_id: null,
      work_item_id: "story-1",
      status: "pending",
      error: null,
      failure: null,
      retryable: true,
      agent_run_id: "run-1",
      delivery_mode: mode,
      updated_at: "2026-09-01T12:00:00.000Z",
    },
    committed_at: "2026-09-01T12:00:00.000Z",
  } satisfies RunStatusEventFrame;
}

describe("durable automation delivery facts", () => {
  it("carries a continued handoff into the status feed", () => {
    const fact = readStatusFact(delivery("continued"));

    expect(fact?.family).toBe("automation_attempt");
    expect(fact).toMatchObject({
      attempt: { attempt_id: "attempt-1", delivery_mode: "continued" },
    });
  });

  it("distinguishes a fresh start from a continued session", () => {
    const fact = readStatusFact(delivery("started_fresh"));

    expect(fact).toMatchObject({
      attempt: { delivery_mode: "started_fresh" },
    });
  });
});
