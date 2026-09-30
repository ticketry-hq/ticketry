import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePerformanceCompareOptions,
  parsePerformanceDesktopOptions,
  parsePerformancePrepareOptions,
  parsePerformanceRunOptions,
} from "./options.mjs";

test("a plain run measures the default scenarios on chromium", () => {
  const options = parsePerformanceRunOptions([]);
  assert.equal(options.engine, "chromium");
  assert.deepEqual(options.scenarios, ["idle", "module-picker"]);
  assert.equal(options.dataset, "small");
  assert.deepEqual(options.captures, []);
  assert.equal(options.allowStaleBuild, false);
});

test("scenarios and captures accumulate and deduplicate", () => {
  const options = parsePerformanceRunOptions([
    "--scenario", "idle",
    "--scenario", "idle,module-navigation",
    "--capture", "cpu",
    "--capture", "cpu,trace",
  ]);
  assert.deepEqual(options.scenarios, ["idle", "module-navigation"]);
  assert.deepEqual(options.captures, ["cpu", "trace"]);
});

test("an unknown scenario names the ones that exist", () => {
  assert.throws(
    () => parsePerformanceRunOptions(["--scenario", "everything"]),
    /Known scenarios: idle, module-picker/,
  );
});

test("a Chromium-only capture is refused on WebKit", () => {
  assert.throws(
    () => parsePerformanceRunOptions(["--engine", "webkit", "--capture", "cpu"]),
    /needs the Chromium DevTools protocol/,
  );
  // A Playwright trace is engine-independent and stays allowed.
  const traced = parsePerformanceRunOptions(["--engine", "webkit", "--capture", "trace"]);
  assert.deepEqual(traced.captures, ["trace"]);
});

test("unsupported options fail before anything is built or launched", () => {
  assert.throws(() => parsePerformanceRunOptions(["--profile"]), /Unsupported option --profile/);
  assert.throws(() => parsePerformanceRunOptions(["--engine"]), /--engine needs a value/);
  assert.throws(() => parsePerformanceRunOptions(["--engine", "firefox"]), /--engine must be one of/);
  assert.throws(
    () => parsePerformanceRunOptions(["--repetitions", "0"]),
    /--repetitions must be a positive integer/,
  );
});

test("comparison requires both run directories", () => {
  assert.throws(() => parsePerformanceCompareOptions(["--baseline", "a"]), /usage:/);
  const options = parsePerformanceCompareOptions([
    "--baseline", "a", "--candidate", "b", "--informational",
  ]);
  assert.deepEqual(options, { baseline: "a", candidate: "b", informational: true });
});

test("preparation accepts only an adapter profile", () => {
  assert.deepEqual(parsePerformancePrepareOptions([]), { adapterProfile: "debug" });
  assert.throws(
    () => parsePerformancePrepareOptions(["--adapter-profile", "fast"]),
    /--adapter-profile must be one of/,
  );
  // CODING-1487 — no renderer artifact is built before a profiling run any
  // more, so the skip that existed to avoid building one is gone too.
  assert.throws(
    () => parsePerformancePrepareOptions(["--skip-ghostty"]),
    /Unsupported option --skip-ghostty/,
  );
});

test("desktop confirmation defaults to every scenario WebDriver can reach", () => {
  assert.deepEqual(
    parsePerformanceDesktopOptions([]).scenarios,
    ["idle", "module-picker", "module-navigation", "changes-loading"],
  );
  assert.throws(
    () => parsePerformanceDesktopOptions(["--scenario", "retention"]),
    /Unknown desktop --scenario retention/,
  );
});

test("desktop confirmation accepts the Changes loading baseline", () => {
  assert.deepEqual(
    parsePerformanceDesktopOptions(["--scenario", "changes-loading"]).scenarios,
    ["changes-loading"],
  );
});

test("an explicitly requested port is carried through, and a bad one is refused", () => {
  const options = parsePerformanceRunOptions([
    "--scenario", "idle", "--frontend-port", "4999", "--adapter-port", "8999",
  ]);
  assert.equal(options.frontendPort, 4999);
  assert.equal(options.adapterPort, 8999);
  assert.throws(() => parsePerformanceRunOptions(["--mcp-port", "8999"]), /Unsupported option/);
  assert.throws(
    () => parsePerformanceRunOptions(["--frontend-port", "0"]),
    /between 1 and 65535/,
  );
  assert.throws(
    () => parsePerformanceRunOptions(["--adapter-port", "not-a-port"]),
    /between 1 and 65535/,
  );
});

test("ports default to null so the run takes its dedicated ports", () => {
  const options = parsePerformanceRunOptions(["--scenario", "idle"]);
  assert.equal(options.frontendPort, null);
  assert.equal(options.adapterPort, null);

});
