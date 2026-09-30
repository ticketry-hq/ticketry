import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CHECKS,
  renderChecklist,
  runHardwareCheck,
} from "./launchkey-hardware-check.mjs";

const scriptPath = fileURLToPath(
  new URL("./launchkey-hardware-check.mjs", import.meta.url),
);

test("the hardware check names every required observable behavior", () => {
  assert.deepEqual(
    CHECKS.map(({ id }) => id),
    [
      "connect",
      "hot-plug",
      "lighting",
      "focus",
      "record",
      "play",
      "project-switching",
      "shell-exclusion",
      "standalone-restoration",
    ],
  );
});

test("the printed checklist states the action and observable result for each check", () => {
  const checklist = renderChecklist();

  for (const check of CHECKS) {
    assert.match(checklist, new RegExp(`\\[${check.id}\\]`));
    assert.ok(checklist.includes(check.action));
    assert.ok(checklist.includes(check.expect));
  }
  assert.match(checklist, /Launchkey Mini MK3/);
  assert.match(checklist, /npm run desktop:dev/);
});

test("the interactive check refuses to certify hardware on a non-macOS host", async () => {
  let prompted = false;
  const result = await runHardwareCheck({
    platform: "linux",
    ask: async () => {
      prompted = true;
      return "pass";
    },
  });

  assert.equal(prompted, false);
  assert.equal(result.exitCode, 2);
  assert.match(result.report, /requires macOS hardware/);
});

test("an all-pass macOS run emits complete revision-linked evidence", async () => {
  const promptedIds = [];
  const result = await runHardwareCheck({
    platform: "darwin",
    ask: async (check) => {
      promptedIds.push(check.id);
      return "pass observed on hardware";
    },
    now: new Date("2026-09-04T12:34:56.000Z"),
    metadata: {
      revision: "abc1234",
      host: "macOS 15.6 arm64",
    },
  });

  assert.deepEqual(promptedIds, CHECKS.map(({ id }) => id));
  assert.equal(result.exitCode, 0);
  assert.match(result.report, /Outcome \| PASS/);
  assert.match(result.report, /Revision \| `abc1234`/);
  assert.match(result.report, /Recorded \| 2026-09-04T12:34:56\.000Z/);
  for (const check of CHECKS) {
    assert.match(result.report, new RegExp(`\\| ${check.id} \\| PASS \\|`));
  }
});

test("the check retries invalid answers and returns failure evidence", async () => {
  const answers = [
    "maybe",
    "fail device stayed in standalone mode",
    ...CHECKS.slice(1).map(() => "pass"),
  ];
  const promptedIds = [];
  const result = await runHardwareCheck({
    platform: "darwin",
    ask: async (check) => {
      promptedIds.push(check.id);
      return answers.shift();
    },
    now: new Date("2026-09-04T12:34:56.000Z"),
  });

  assert.deepEqual(promptedIds.slice(0, 2), ["connect", "connect"]);
  assert.equal(result.exitCode, 1);
  assert.match(
    result.report,
    /\| connect \| FAIL \| device stayed in standalone mode \|/,
  );
  assert.match(result.report, /Outcome \| FAIL/);
});

test("the CLI can print the hardware plan without attached hardware", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--list"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), renderChecklist());
});
