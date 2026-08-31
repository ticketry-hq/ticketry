#!/usr/bin/env node
/**
 * CODING-1304 — turn captured renderer measurements into the comparison matrix.
 *
 * Input files are the JSON a Studio window produces from
 * `window.__ticketryRendererMeasurements()`, wrapped with the context the
 * ticket requires for every result: command, terminal dimensions, sample
 * duration, machine, build mode and measurement method. Context that was not
 * recorded is reported as missing rather than silently omitted, so a matrix
 * row can never look complete when it is not.
 *
 * Usage: node scripts/renderer-comparison-report.mjs capture-*.json
 */
import { readFile } from "node:fs/promises";

export const REQUIRED_CONTEXT = [
  "command",
  "dimensions",
  "sampleSeconds",
  "machine",
  "buildMode",
  "method",
];

const RENDERERS = ["native", "xterm", "ghostty-wasm"];

/** Average a numeric field across samples, ignoring nulls. */
function mean(samples, field) {
  const values = samples.map((sample) => sample[field]).filter((value) => typeof value === "number");
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function maximum(samples, field) {
  const values = samples.map((sample) => sample[field]).filter((value) => typeof value === "number");
  if (values.length === 0) return null;
  return Math.max(...values);
}

/**
 * Reduce raw captures into one row per renderer.
 *
 * Every capture keeps its own missing-context list; a renderer with no capture
 * is still emitted so the matrix shows the gap.
 */
export function buildRendererComparison(captures) {
  const byRenderer = new Map(RENDERERS.map((renderer) => [renderer, []]));
  const problems = [];

  for (const capture of captures) {
    const missing = REQUIRED_CONTEXT.filter((field) => capture?.context?.[field] == null);
    if (missing.length > 0) {
      problems.push({
        capture: capture?.context?.label ?? "(unlabelled capture)",
        missingContext: missing,
      });
    }
    for (const sample of capture?.samples ?? []) {
      const bucket = byRenderer.get(sample.renderer);
      if (!bucket) {
        problems.push({
          capture: capture?.context?.label ?? "(unlabelled capture)",
          unknownRenderer: sample.renderer,
        });
        continue;
      }
      bucket.push(sample);
    }
  }

  const rows = RENDERERS.map((renderer) => {
    const samples = byRenderer.get(renderer);
    return {
      renderer,
      samples: samples.length,
      coldAttachMs: mean(samples, "coldAttachMs"),
      warmAttachMs: mean(samples, "warmAttachMs"),
      frames: samples.reduce((total, sample) => total + (sample.frames ?? 0), 0),
      bytes: samples.reduce((total, sample) => total + (sample.bytes ?? 0), 0),
      paintMsP50: mean(samples, "paintMsP50"),
      paintMsP95: mean(samples, "paintMsP95"),
      paintMsMax: maximum(samples, "paintMsMax"),
      wasmMemoryBytes: maximum(samples, "wasmMemoryBytes"),
    };
  });

  return { rows, problems };
}

function cell(value, digits = 1) {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number") return String(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function bytesCell(value) {
  if (value === null || value === undefined) return "—";
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}

/** Render the comparison as the markdown table the evidence document holds. */
export function renderRendererComparison(comparison) {
  const header = [
    "| Renderer | Samples | Cold attach (ms) | Warm attach (ms) | Frames | Bytes | Paint p50 (ms) | Paint p95 (ms) | Paint max (ms) | Wasm memory |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  const body = comparison.rows.map((row) =>
    [
      `| \`${row.renderer}\``,
      cell(row.samples),
      cell(row.coldAttachMs),
      cell(row.warmAttachMs),
      cell(row.frames),
      cell(row.bytes),
      cell(row.paintMsP50, 2),
      cell(row.paintMsP95, 2),
      cell(row.paintMsMax, 2),
      `${bytesCell(row.wasmMemoryBytes)} |`,
    ].join(" | "),
  );

  const lines = [...header, ...body];
  if (comparison.problems.length > 0) {
    lines.push("", "**Incomplete captures**", "");
    for (const problem of comparison.problems) {
      if (problem.missingContext) {
        lines.push(`- ${problem.capture}: missing ${problem.missingContext.join(", ")}`);
      } else {
        lines.push(`- ${problem.capture}: unknown renderer \`${problem.unknownRenderer}\``);
      }
    }
  }
  return lines.join("\n");
}

async function main(paths) {
  if (paths.length === 0) {
    process.stderr.write(
      "usage: node scripts/renderer-comparison-report.mjs <capture.json>...\n",
    );
    process.exitCode = 2;
    return;
  }
  const captures = [];
  for (const path of paths) {
    captures.push(JSON.parse(await readFile(path, "utf8")));
  }
  process.stdout.write(`${renderRendererComparison(buildRendererComparison(captures))}\n`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv.slice(2));
}
