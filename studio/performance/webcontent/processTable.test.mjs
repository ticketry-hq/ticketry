import assert from "node:assert/strict";
import { test } from "node:test";

import { parseProcessTable, parseResourceRow } from "./processTable.mjs";

// Verbatim `ps -Ao pid=,ppid=,lstart=,comm=` output from the observed host.
const PS_OUTPUT = `
 8610     1 Sat Sep  5 11:11:18 2026 /Applications/Ticketry.app/Contents/MacOS/ticketry
 8613     1 Sat Sep  5 11:11:20 2026 /System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent
23434     1 Sat Sep  5 07:44:16 2026 /System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent
`;

test("reads pid, parent, launch time and full command from ps output", () => {
  const rows = parseProcessTable(PS_OUTPUT);

  assert.equal(rows.length, 3);
  assert.deepEqual(
    { pid: rows[0].pid, ppid: rows[0].ppid, command: rows[0].command },
    { pid: 8610, ppid: 1, command: "/Applications/Ticketry.app/Contents/MacOS/ticketry" },
  );
  assert.equal(rows[1].pid, 8613);
});

test("launch times keep the two-second gap between the window and its content process", () => {
  const [gui, webContent] = parseProcessTable(PS_OUTPUT);

  assert.equal((webContent.startedAtMs - gui.startedAtMs) / 1000, 2);
});

test("a command containing spaces is kept whole rather than split", () => {
  const [row] = parseProcessTable(
    " 42 1 Sat Sep  5 11:11:18 2026 /Applications/Some App.app/Contents/MacOS/Some App\n",
  );

  assert.equal(row.command, "/Applications/Some App.app/Contents/MacOS/Some App");
});

test("a single-digit day of month is parsed, not dropped as unparseable", () => {
  const [row] = parseProcessTable(" 42 1 Wed Sep  9 01:02:03 2026 /bin/sh\n");

  assert.equal(new Date(row.startedAtMs).getFullYear(), 2026);
});

test("lines ps could not format are skipped instead of becoming NaN rows", () => {
  const rows = parseProcessTable("garbage\n 42 1 Sat Sep  5 11:11:18 2026 /bin/sh\n\n");

  assert.deepEqual(rows.map(({ pid }) => pid), [42]);
});

test("rss is reported in bytes, not the kibibytes ps prints", () => {
  const sample = parseResourceRow("  1024   3.5\n", 8613);

  assert.equal(sample.rssBytes, 1024 * 1024);
  assert.equal(sample.cpuPercent, 3.5);
  assert.equal(sample.reason, null);
});

test("a process that has exited is unavailable with a reason, not zero bytes", () => {
  const sample = parseResourceRow("", 8613);

  assert.equal(sample.rssBytes, null);
  assert.equal(sample.cpuPercent, null);
  assert.match(sample.reason, /8613 is no longer running/);
});
