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
