import assert from "node:assert/strict";
import { test } from "node:test";

import { FOOTPRINT_ARGUMENTS, parseFootprintReport } from "./footprint.mjs";

// Trimmed from a real `footprint -p 8613 --json` on the observed host.
const REPORT = {
  unit: "byte",
  "bytes per unit": 1,
  start_time: { date: "2026-09-05T11:27:12.932+05:30" },
  processes: [{
    name: "com.apple.WebKit.WebContent",
    pid: 8613,
    "page size": 16384,
    footprint: 1211074672,
    categories: {
      "WebKit malloc": {
        dirty: 902840320, swapped: 53346304, clean: 0,
        reclaimable: 554303488, wired: 0, regions: 60,
      },
      "JS JIT generated code": {
        dirty: 9748480, swapped: 0, clean: 0, reclaimable: 65536, wired: 0, regions: 3,
      },
      stack: { dirty: 655360, swapped: 0, clean: 0, reclaimable: 0, wired: 0, regions: 26 },
    },
  }],
};

test("reads the footprint and its category breakdown for the named process", () => {
  const sample = parseFootprintReport(REPORT, 8613);

  assert.equal(sample.pid, 8613);
  assert.equal(sample.footprintBytes, 1211074672);
  assert.equal(sample.categories["WebKit malloc"].dirty, 902840320);
  assert.equal(sample.categories["WebKit malloc"].reclaimable, 554303488);
  assert.equal(sample.reason, null);
});

test("keeps the report's own timestamp rather than the reader's clock", () => {
  assert.equal(parseFootprintReport(REPORT, 8613).at, "2026-09-05T11:27:12.932+05:30");
});

test("selects by pid when the report covers several processes", () => {
  const report = {
    ...REPORT,
    processes: [
      { name: "other", pid: 999, footprint: 1, categories: {} },
      REPORT.processes[0],
    ],
  };

  assert.equal(parseFootprintReport(report, 8613).footprintBytes, 1211074672);
});

test("a process absent from the report is unavailable with a reason, not zero bytes", () => {
  const sample = parseFootprintReport(REPORT, 4242);

  assert.equal(sample.footprintBytes, null);
  assert.deepEqual(sample.categories, {});
  assert.match(sample.reason, /4242 is not in this footprint report/);
});

test("a report in units other than bytes is refused rather than mis-scaled", () => {
  const sample = parseFootprintReport({ ...REPORT, unit: "page" }, 8613);

  assert.equal(sample.footprintBytes, null);
  assert.match(sample.reason, /unit "page"/);
});

test("an unreadable report is unavailable with a reason", () => {
  assert.match(parseFootprintReport(null, 8613).reason, /no footprint report/);
});

test("footprint is asked for byte units explicitly, so the parser's unit check can hold", () => {
  assert.ok(FOOTPRINT_ARGUMENTS(8613, "/tmp/out.json").includes("bytes"));
  assert.ok(FOOTPRINT_ARGUMENTS(8613, "/tmp/out.json").includes("/tmp/out.json"));
});
