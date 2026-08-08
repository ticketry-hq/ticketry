import Ajv, { type ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";

import schema from "./chat-wire-frames.schema.json";
import type { ChatClientCommand, ChatServerFrame } from "./types";

const ajv = new Ajv({ strict: false, allowUnionTypes: true });
const validate: ValidateFunction = ajv.compile(schema);

function assertValid(frame: unknown): void {
  const ok = validate(frame);
  if (!ok) {
    throw new Error(`Chat frame failed schema: ${ajv.errorsText(validate.errors)}`);
  }
  expect(ok).toBe(true);
}

const clientFrames = [
  { v: 1, type: "start_turn", command_id: "command-1", prompt: "Inspect this" },
  { v: 1, type: "interrupt", command_id: "command-2" },
  {
    v: 1,
    type: "respond_approval",
    command_id: "command-3",
    request_id: "approval-1",
    decision: "accept",
  },
  {
    v: 1,
    type: "respond_user_input",
    command_id: "command-4",
    request_id: "input-1",
    answers: { scope: ["Studio"] },
  },
  { v: 1, type: "stop", command_id: "command-5" },
] satisfies ChatClientCommand[];

const run = {
  agent_run_id: "chat-1",
  project_id: "project-1",
  module_id: "module-1",
  task_id: "task-1",
  agent: "codex",
  run_kind: "chat",
  scope: "task",
  status: "running",
  state: null,
  started_at: "2026-08-08T00:00:00Z",
  ended_at: null,
  cwd: "/workspace",
};

const session = {
  provider_thread_id: "thread-1",
  status: "ready",
  active_turn_id: null,
  last_error: null,
  next_sequence: 2,
  last_sequence: 1,
  created_at: "2026-08-08T00:00:00Z",
  updated_at: "2026-08-08T00:00:01Z",
};

const event = {
  sequence: 1,
  event_type: "thread.session-set",
  payload: { threadId: "thread-1" },
  created_at: "2026-08-08T00:00:01Z",
};

const serverFrames = [
  {
    v: 1,
    type: "snapshot",
    agent_run_id: "chat-1",
    run,
    session,
    events: [event],
    cursor: 1,
  },
  { v: 1, type: "event", agent_run_id: "chat-1", event },
  { v: 1, type: "ready", agent_run_id: "chat-1", cursor: 1 },
  {
    v: 1,
    type: "ack",
    agent_run_id: "chat-1",
    command_id: "command-1",
    command: "start_turn",
    result: { turn_id: "turn-1" },
  },
  {
    v: 1,
    type: "error",
    agent_run_id: "chat-1",
    command_id: null,
    code: "invalid_frame",
    message: "Invalid command",
    retryable: false,
  },
] satisfies ChatServerFrame[];

describe("Chat WebSocket frames match the checked backend schema", () => {
  it("accepts every client and server discriminant", () => {
    for (const frame of [...clientFrames, ...serverFrames]) assertValid(frame);
  });

  it("rejects missing authoritative server fields and invented ack cursor", () => {
    const missingRunId = { ...serverFrames[3] } as Record<string, unknown>;
    delete missingRunId.agent_run_id;
    expect(validate(missingRunId)).toBe(false);

    expect(validate({ ...serverFrames[3], cursor: 1 })).toBe(false);
  });

  it("rejects a turn command without its durable command identity", () => {
    const missingCommandId = { ...clientFrames[0] } as Record<string, unknown>;
    delete missingCommandId.command_id;
    expect(validate(missingCommandId)).toBe(false);
  });
});
