import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("planning alias selects all seven Plan and Sprints feature suites through the generic runner", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["test:e2e:planning"], "node scripts/run-feature-e2e.mjs plan-workspace-navigation,sprint-lifecycle-and-goals,epic-planning,inline-story-creation-in-plan,story-moves,suggestion-review,background-discovery-and-recovery");
});
