import Ajv, { type ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";

import {
  buildAttachInit,
  buildResize,
  buildScroll,
  buildSpawnInit,
  type SpawnParams,
} from "../shared/api/transport/wireContract";
import schema from "../shared/api/transport/wire-frames.schema.json";
import openapi from "../../../openapi.json";
import type { RunRecord } from "../features/agents/status";

// The committed schema is exported by the backend (`manage.py
// export_wire_frames`) from backend/apps/terminals/frames.py. Validating each builder
// against it proves the TS frame definitions and the backend's declared models
// cannot silently diverge — the CODIN-685 missing-`mode` bug class is caught
// here instead of in production.

const ajv = new Ajv({ strict: false, allowUnionTypes: true });
const validate: ValidateFunction = ajv.compile(schema);

const SPAWN: SpawnParams = {
  agent: "claude",
  project_id: "p1",
  module_id: "m1",
  task_id: "t1",
  initial_prompt: null,
  cols: 80,
  rows: 24,
  is_planning: false,
  is_instant: false,
  instant_prompt: null,
  is_doc_chat: false,
  doc_rel_path: null,
  doc_id: null,
};

function assertValid(frame: unknown): void {
  const ok = validate(frame);
  if (!ok) {
    throw new Error(`frame failed schema: ${ajv.errorsText(validate.errors)}`);
  }
  expect(ok).toBe(true);
}

describe("wire-contract builders validate against the backend schema", () => {
  it("buildSpawnInit produces a schema-valid spawn frame with explicit mode", () => {
    const frame = buildSpawnInit(SPAWN);
    expect(frame.mode).toBe("spawn");
    assertValid(frame);
  });

  it("buildSpawnInit is valid for every spawn variant (planning, instant, doc-chat)", () => {
    assertValid(buildSpawnInit({ ...SPAWN, task_id: null, is_planning: true }));
    assertValid(
      buildSpawnInit({ ...SPAWN, task_id: null, is_instant: true, instant_prompt: "go" }),
    );
    assertValid(
      buildSpawnInit({
        ...SPAWN,
        task_id: null,
        is_doc_chat: true,
        doc_rel_path: "LLD.html",
        doc_id: "d1",
      }),
    );
  });

  it("buildAttachInit produces a schema-valid attach frame with explicit mode", () => {
    const frame = buildAttachInit("run-abc", 132, 43);
    expect(frame.mode).toBe("attach");
    assertValid(frame);
  });

  it("buildResize and buildScroll produce schema-valid frames", () => {
    assertValid(buildResize(100, 30));
    assertValid(buildScroll("up", 3));
    assertValid(buildScroll("down", 12));
  });
});

// The run record travels on a second wire — the OpenAPI document the backend
// exports from its DRF serializers (`npm run openapi:export`) and both SDKs are
// generated from. Validating Studio's own `RunRecord` values against it proves
// the TS run type and the backend's declared schema cannot silently diverge,
// which is what a null `agent` and a new scope would otherwise do quietly.
const openapiSchemas = (
  openapi as unknown as { components: { schemas: Record<string, object> } }
).components.schemas;
const validateRunRecord: ValidateFunction = new Ajv({
  strict: false,
  allowUnionTypes: true,
  schemas: openapiSchemas,
}).compile({
  ...openapiSchemas.AgentRunRecord,
  components: { schemas: openapiSchemas },
});

const AGENT_RUN: RunRecord = {
  agent_run_id: "run-agent",
  project_id: "p1",
  task_id: "t1",
  module_id: "m1",
  agent: "claude",
  scope: "task",
  launch_state: "Grill",
  launch_model: "opus-5",
  started_at: "2026-08-15T10:00:00+00:00",
  state: "working",
  updated_at: "2026-08-15T10:00:01+00:00",
  output_sequence: 3,
  last_output_at: "2026-08-15T10:00:01+00:00",
  effective_state: "working",
};

function assertValidRunRecord(record: RunRecord): void {
  const ok = validateRunRecord(record);
  if (!ok) {
    throw new Error(`run record failed schema: ${ajv.errorsText(validateRunRecord.errors)}`);
  }
  expect(ok).toBe(true);
}

describe("the run record wire contract covers agent and shell runs", () => {
  it("validates an agent run exactly as before", () => {
    assertValidRunRecord(AGENT_RUN);
  });

  it("validates every agent-run scope", () => {
    for (const scope of ["task", "plan", "instant", "docchat"] as const) {
      assertValidRunRecord({ ...AGENT_RUN, scope });
    }
  });

  it("validates a shell run: the shell scope with no agent", () => {
    assertValidRunRecord({
      ...AGENT_RUN,
      agent_run_id: "run-shell",
      task_id: null,
      agent: null,
      scope: "shell",
      state: "unknown",
      effective_state: "unknown",
    });
  });

  it("declares the shell scope on the wire rather than a fabricated provider", () => {
    const scopes = (openapiSchemas.ScopeEnum as { enum: string[] }).enum;
    expect(scopes).toContain("shell");
    // Every scope the backend recognises must be expressible by Studio's own
    // union, or a run would arrive that no reader can name.
    for (const scope of scopes) {
      assertValidRunRecord({ ...AGENT_RUN, scope: scope as RunRecord["scope"] });
    }
  });

  it("validates a run whose launch snapshot was never recorded", () => {
    // The snapshot is nullable for compatibility: runs that predate it are
    // projected as null rather than backfilled, and the wire must accept that
    // as readily as a populated one.
    assertValidRunRecord({
      ...AGENT_RUN,
      launch_state: null,
      launch_model: null,
    });
  });

  it("rejects a run record with the agent key removed rather than nulled", () => {
    const record: Record<string, unknown> = { ...AGENT_RUN };
    delete record.agent;
    expect(validateRunRecord(record)).toBe(false);
  });

  it("rejects an unknown scope", () => {
    expect(validateRunRecord({ ...AGENT_RUN, scope: "sh3ll" })).toBe(false);
  });
});

describe("the contract has teeth", () => {
  it("rejects a spawn frame with `mode` removed", () => {
    const frame: Record<string, unknown> = { ...buildSpawnInit(SPAWN) };
    delete frame.mode;
    expect(validate(frame)).toBe(false);
  });

  it("rejects an attach frame with `mode` removed", () => {
    const frame: Record<string, unknown> = { ...buildAttachInit("run-abc", 80, 24) };
    delete frame.mode;
    expect(validate(frame)).toBe(false);
  });

  it("rejects a spawn frame missing a required field (cols)", () => {
    const frame: Record<string, unknown> = { ...buildSpawnInit(SPAWN) };
    delete frame.cols;
    expect(validate(frame)).toBe(false);
  });
});
