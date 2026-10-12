import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { repositoryRoot } from "../desktop-installation/acceptance-build.mjs";
import { SUBTREE_CASES } from "./edition-cases.mjs";

// CODING-2856 — pull requests are gated on the desktop subtree journey in
// every edition it has cases for. The workflow is read as text: each job is
// the block indented under `jobs:` until the next job key.
const workflow = readFileSync(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");

function jobBlock(name) {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `ci.yml has no ${name} job`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

const guard = (block) => block.match(/ {4}if: >-\n((?: {6}.+\n)+)/)?.[1];

test("the subtree job runs one leg per edition the journey defines, without cancelling the other", () => {
  const job = jobBlock("desktop-subtree");
  assert.match(job, /runs-on: macos-26/);
  assert.match(job, /fail-fast: false/);
  const editions = job.match(/edition: \[([^\]]+)\]/)?.[1].split(",").map((value) => value.trim());
  assert.deepEqual(editions?.sort(), Object.keys(SUBTREE_CASES).sort());
  assert.match(job, /TICKETRY_EDITION: \$\{\{ matrix\.edition \}\}/);
  assert.match(job, /run: bun run --cwd studio test:e2e:desktop:subtree\n/);
  const minutes = Number(job.match(/^ {4}timeout-minutes: (\d+)/m)?.[1]);
  assert.ok(minutes >= 40 && minutes <= 50, `job timeout ${minutes} is not about 45 minutes`);
});

test("the subtree job keeps the desktop job's repository-only guard", () => {
  const desktopGuard = guard(jobBlock("desktop"));
  assert.ok(desktopGuard, "the desktop job lost its repository-only guard");
  assert.equal(guard(jobBlock("desktop-subtree")), desktopGuard);
});

test("a failing leg uploads the desktop diagnostics under an edition-named artifact", () => {
  const job = jobBlock("desktop-subtree");
  const upload = job.slice(job.indexOf("uses: actions/upload-artifact"));
  assert.match(job, /if: failure\(\)\n\s+uses: actions\/upload-artifact/);
  assert.match(upload, /name: desktop-subtree-diagnostics-\$\{\{ matrix\.edition \}\}/);
  assert.match(upload, /path: studio\/test-results\//);
});

test("the single-run desktop acceptance step stays in the desktop job", () => {
  const job = jobBlock("desktop");
  assert.match(job, /run: bun run --cwd studio test:e2e:desktop\n/);
  assert.doesNotMatch(job, /test:e2e:desktop:subtree/);
});
