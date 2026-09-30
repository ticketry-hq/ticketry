/**
 * Assembling one WebContent memory capture.
 *
 * The sampling loop's only subtle job is knowing when it stopped measuring the
 * thing it started measuring. A WKWebView content process can be replaced —
 * WebKit respawns it after a crash or a jetsam kill, and the packaged
 * application can itself be relaunched — and macOS recycles pids. Joining
 * samples from either side of that boundary produces a growth figure for a
 * process that never grew, so continuity is checked on every tick and a break
 * ends the capture with the break recorded.
 */
import { WEB_CONTENT_COMMAND } from "./attribution.mjs";
import {
  CAPTURE_KIND,
  WEBCONTENT_CAPTURE_SCHEMA_VERSION,
  assertValidCapture,
} from "./schema.mjs";
import { summarizeWebContentCapture } from "./summarize.mjs";

/**
 * Is the capture still watching the processes it attributed?
 * Returns `null` while it is, or the break that ended it.
 */
export function inspectContinuity({ guiPid, webContentPid, processTable }) {
  const gui = processTable.find((row) => row.pid === guiPid);
  if (!gui) {
    return {
      kind: "gui-gone",
      detail: `GUI process ${guiPid} exited, so the window under measurement no longer exists`,
    };
  }
  const attributed = processTable.find((row) => row.pid === webContentPid);
  if (attributed) return null;

  const replacements = processTable
    .filter((row) => row.command.includes(WEB_CONTENT_COMMAND))
    .map(({ pid }) => pid);
  if (replacements.length > 0) {
    return {
      kind: "webcontent-restart",
      detail:
        `content process ${webContentPid} exited while `
        + `${replacements.join(", ")} are running; a replacement is a different `
        + "process and its samples are not a continuation of these",
      replacementCandidates: replacements,
    };
  }
  return {
    kind: "webcontent-gone",
    detail: `content process ${webContentPid} exited and was not replaced`,
  };
}

export function buildCapture({
  scenario,
  build,
  machine,
  attribution,
  instrumentation,
  samples,
  discontinuities = [],
  capturedAt = new Date().toISOString(),
}) {
  const capture = {
    schemaVersion: WEBCONTENT_CAPTURE_SCHEMA_VERSION,
    kind: CAPTURE_KIND,
    capturedAt,
    scenario,
    build,
    machine,
    attribution,
    instrumentation,
    discontinuities,
    samples,
  };
  assertValidCapture(capture);
  capture.summary = summarizeWebContentCapture(capture);
  return capture;
}
