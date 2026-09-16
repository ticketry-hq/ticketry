import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveWebContentProcess } from "./attribution.mjs";

const GUI_COMMAND = "/Applications/Ticketry.app/Contents/MacOS/ticketry";
const WEB_CONTENT_COMMAND =
  "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/"
  + "com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent";

function table(rows) {
  return rows.map((row) => ({ ppid: 1, ...row }));
}

test("attributes the single WebKit content process that started with the GUI process", () => {
  const resolved = resolveWebContentProcess({
    platform: "darwin",
    guiPid: 8610,
    processTable: table([
      { pid: 8610, startedAtMs: Date.parse("2026-09-05T11:11:18Z"), command: GUI_COMMAND },
      { pid: 8613, startedAtMs: Date.parse("2026-09-05T11:11:20Z"), command: WEB_CONTENT_COMMAND },
      { pid: 23434, startedAtMs: Date.parse("2026-09-05T07:44:16Z"), command: WEB_CONTENT_COMMAND },
    ]),
  });

  assert.equal(resolved.pid, 8613);
  assert.equal(resolved.reason, null);
  assert.equal(resolved.evidence.offsetSeconds, 2);
  assert.equal(resolved.evidence.guiPid, 8610);
  assert.deepEqual(resolved.evidence.rejectedPids, [23434]);
});

test("refuses when no content process started inside the launch window", () => {
  const resolved = resolveWebContentProcess({
    platform: "darwin",
    guiPid: 8610,
    windowSeconds: 60,
    processTable: table([
      { pid: 8610, startedAtMs: Date.parse("2026-09-05T11:11:18Z"), command: GUI_COMMAND },
      { pid: 23434, startedAtMs: Date.parse("2026-09-05T07:44:16Z"), command: WEB_CONTENT_COMMAND },
    ]),
  });

  assert.equal(resolved.pid, null);
  assert.match(resolved.reason, /no WebKit content process started within 60s/);
});

test("refuses rather than guessing when several content processes share the window", () => {
  const resolved = resolveWebContentProcess({
    platform: "darwin",
    guiPid: 8610,
    processTable: table([
      { pid: 8610, startedAtMs: Date.parse("2026-09-05T11:11:18Z"), command: GUI_COMMAND },
      { pid: 8613, startedAtMs: Date.parse("2026-09-05T11:11:20Z"), command: WEB_CONTENT_COMMAND },
      { pid: 8614, startedAtMs: Date.parse("2026-09-05T11:11:21Z"), command: WEB_CONTENT_COMMAND },
    ]),
  });

  assert.equal(resolved.pid, null);
  assert.match(resolved.reason, /2 WebKit content processes/);
  assert.deepEqual(resolved.candidates, [8613, 8614]);
});

test("never attributes a content process that started before the GUI process", () => {
  const resolved = resolveWebContentProcess({
    platform: "darwin",
    guiPid: 8610,
    processTable: table([
      { pid: 8610, startedAtMs: Date.parse("2026-09-05T11:11:18Z"), command: GUI_COMMAND },
      { pid: 8600, startedAtMs: Date.parse("2026-09-05T11:11:17Z"), command: WEB_CONTENT_COMMAND },
    ]),
  });

  assert.equal(resolved.pid, null);
  assert.match(resolved.reason, /no WebKit content process started within/);
});

test("refuses when the named GUI process is not running", () => {
  const resolved = resolveWebContentProcess({
    platform: "darwin",
    guiPid: 8610,
    processTable: table([
      { pid: 8613, startedAtMs: Date.parse("2026-09-05T11:11:20Z"), command: WEB_CONTENT_COMMAND },
    ]),
  });

  assert.equal(resolved.pid, null);
  assert.match(resolved.reason, /GUI process 8610 is not running/);
});

test("refuses when the named GUI process is not the packaged application", () => {
  const resolved = resolveWebContentProcess({
    platform: "darwin",
    guiPid: 8610,
    expectedGuiCommand: GUI_COMMAND,
    processTable: table([
      { pid: 8610, startedAtMs: Date.parse("2026-09-05T11:11:18Z"), command: "/usr/bin/vim" },
      { pid: 8613, startedAtMs: Date.parse("2026-09-05T11:11:20Z"), command: WEB_CONTENT_COMMAND },
    ]),
  });

  assert.equal(resolved.pid, null);
  assert.match(resolved.reason, /runs \/usr\/bin\/vim/);
});

test("reports attribution as unavailable off macOS instead of returning a pid", () => {
  const resolved = resolveWebContentProcess({ platform: "linux", guiPid: 1, processTable: [] });

  assert.equal(resolved.pid, null);
  assert.match(resolved.reason, /macOS/);
});

test("an operator-asserted pid is recorded as asserted, not as measured evidence", () => {
  const resolved = resolveWebContentProcess({
    platform: "darwin",
    guiPid: 8610,
    assertedWebContentPid: 8613,
    processTable: table([
      { pid: 8610, startedAtMs: Date.parse("2026-09-05T11:11:18Z"), command: GUI_COMMAND },
      { pid: 8613, startedAtMs: Date.parse("2026-09-05T11:11:20Z"), command: WEB_CONTENT_COMMAND },
      { pid: 8614, startedAtMs: Date.parse("2026-09-05T11:11:21Z"), command: WEB_CONTENT_COMMAND },
    ]),
  });

  assert.equal(resolved.pid, 8613);
  assert.equal(resolved.evidence.rule, "operator-asserted");
  assert.equal(resolved.evidence.corroborated, true);
});

test("an operator-asserted pid that is not a content process is refused", () => {
  const resolved = resolveWebContentProcess({
    platform: "darwin",
    guiPid: 8610,
    assertedWebContentPid: 8610,
    processTable: table([
      { pid: 8610, startedAtMs: Date.parse("2026-09-05T11:11:18Z"), command: GUI_COMMAND },
    ]),
  });

  assert.equal(resolved.pid, null);
  assert.match(resolved.reason, /8610 is not a WebKit content process/);
});
