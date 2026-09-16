import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_CONTEXT,
  buildRendererComparison,
  renderRendererComparison,
} from "./renderer-comparison-report.mjs";

const context = {
  label: "burst-80x24",
  command: "cat large.ansi",
  dimensions: "80x24",
  sampleSeconds: 30,
  machine: "M4 Max, macOS 15.4",
  buildMode: "release",
  method: "window.__ticketryRendererMeasurements()",
};

function sample(renderer, overrides = {}) {
  return {
    renderer,
    runId: "run-1",
    coldAttachMs: 100,
    warmAttachMs: 50,
    frames: 10,
    bytes: 1000,
    paintMsTotal: 20,
    paintMsMax: 4,
    paintMsP50: 1,
    paintMsP95: 3,
    ...overrides,
  };
}

test("every renderer gets a row even without a capture", () => {
  const { rows } = buildRendererComparison([]);
  assert.deepEqual(
    rows.map((row) => row.renderer),
    ["native", "xterm"],
  );
  assert.equal(rows[0].samples, 0);
  assert.equal(rows[0].coldAttachMs, null);
});

test("samples are averaged per renderer and totals summed", () => {
  const { rows } = buildRendererComparison([
    {
      context,
      samples: [
        sample("native", { coldAttachMs: 100, frames: 10 }),
        sample("native", { coldAttachMs: 200, frames: 5 }),
        sample("xterm", { coldAttachMs: 300 }),
      ],
    },
  ]);
  const native = rows.find((row) => row.renderer === "native");
  assert.equal(native.coldAttachMs, 150);
  assert.equal(native.frames, 15);
  const xterm = rows.find((row) => row.renderer === "xterm");
  assert.equal(xterm.coldAttachMs, 300);
});

// CODING-1487 — the retired WASM renderer is not a renderer this repository
// can measure any more, so a capture naming it is an unknown renderer.
test("the retired WASM renderer is no longer a comparison row", () => {
  const { rows, problems } = buildRendererComparison([
    { context, samples: [sample("ghostty-wasm")] },
  ]);
  assert.equal(rows.some((row) => row.renderer === "ghostty-wasm"), false);
  assert.equal(problems[0].unknownRenderer, "ghostty-wasm");
});

test("missing measurement context is reported, never dropped", () => {
  const { problems } = buildRendererComparison([
    { context: { label: "no-context" }, samples: [sample("xterm")] },
  ]);
  assert.equal(problems.length, 1);
  assert.deepEqual(
    problems[0].missingContext,
    REQUIRED_CONTEXT.filter((field) => field !== "label"),
  );
});

test("an unknown renderer is surfaced rather than silently binned", () => {
  const { problems } = buildRendererComparison([
    { context, samples: [sample("webgl")] },
  ]);
  assert.equal(problems[0].unknownRenderer, "webgl");
});

test("the rendered table lists every renderer and any incomplete capture", () => {
  const table = renderRendererComparison(
    buildRendererComparison([
      { context, samples: [sample("native")] },
      { context: { label: "partial" }, samples: [] },
    ]),
  );
  assert.match(table, /\| `native`/);
  assert.match(table, /\| `xterm`/);
  assert.match(table, /Incomplete captures/);
  assert.equal(table.includes("Wasm memory"), false);
  assert.match(table, /partial: missing command/);
});
