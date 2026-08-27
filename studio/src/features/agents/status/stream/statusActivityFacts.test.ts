import { describe, expect, it } from "vitest";

import type { RunStatusEventFrame } from "../types";
import { readStatusFact } from "./statusFacts";

const activity = {
  __typename: "RunStatusEvent",
  cursor: 17,
  event_id: "event-17",
  project_id: "project-1",
  event_kind: "agent_run.terminal_activity",
  payload_version: 1,
  subject_kind: "agent_run",
  subject_id: "run-1",
  agent_run_id: "run-1",
  automation_attempt_id: null,
  work_item_id: "story-1",
  payload: {
    type: "terminal_activity",
    at: "2026-08-15T12:01:00.000Z",
    run: {
      agent_run_id: "run-1",
      project_id: "project-1",
      task_id: "story-1",
      module_id: "module-1",
      agent: "codex",
      scope: "task",
      launch_state: "Implement",
      launch_model: "gpt-5.6",
      started_at: "2026-08-15T12:00:00.000Z",
      state: "working",
      effective_state: "working",
      updated_at: "2026-08-15T12:00:00.000Z",
      provider_session_id: null,
      output_sequence: 2,
      last_output_at: "2026-08-15T12:01:00.000Z",
    },
  },
  committed_at: "2026-08-15T12:01:00.000Z",
} satisfies RunStatusEventFrame;

describe("durable terminal activity facts", () => {
  it("carries the independently ordered output axis into Studio", () => {
    expect(readStatusFact(activity)).toEqual({
      family: "agent_run_activity",
      run: {
        agent_run_id: "run-1",
        project_id: "project-1",
        task_id: "story-1",
        module_id: "module-1",
        agent: "codex",
        scope: "task",
        launch_state: "Implement",
        launch_model: "gpt-5.6",
        started_at: "2026-08-15T12:00:00.000Z",
        state: "working",
        effective_state: "working",
        updated_at: "2026-08-15T12:00:00.000Z",
        output_sequence: 2,
        last_output_at: "2026-08-15T12:01:00.000Z",
      },
    });
  });

  it("rejects a malformed run holding", () => {
    expect(
      readStatusFact({
        ...activity,
        payload: { ...activity.payload, run: { agent_run_id: "run-1" } },
      }),
    ).toBeNull();
  });
});
