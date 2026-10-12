import assert from "node:assert/strict";
import test from "node:test";

import { planPlannerAcceptanceBuild } from "./desktop-planner-acceptance-build.mjs";

test("planner desktop acceptance refuses the Pocock edition before building", () => {
  for (const environment of [{}, { TICKETRY_EDITION: "pocock" }]) {
    assert.throws(
      () => planPlannerAcceptanceBuild(environment),
      /^Error: Planner desktop acceptance requires the core edition; rerun with TICKETRY_EDITION=core\.$/,
    );
  }
});

test("planner desktop acceptance builds the core host without default features", () => {
  const plan = planPlannerAcceptanceBuild({ TICKETRY_EDITION: "core", PATH: "/usr/bin" });

  assert.equal(plan.editionBuild.description, "Edition: core (explicit)");
  assert.equal(plan.command, "cargo");
  assert.deepEqual(plan.args, [
    "build",
    "--offline",
    "--manifest-path",
    "studio/src-tauri/Cargo.toml",
    "--bin",
    "ticketry",
    "--no-default-features",
    "--features",
    "desktop-acceptance,edition-core",
  ]);
  assert.equal(plan.environment.TICKETRY_EDITION, "core");
  assert.equal(plan.environment.PATH, "/usr/bin");
  assert.deepEqual(JSON.parse(plan.environment.TAURI_CONFIG), { build: { devUrl: null }, bundle: { resources: [] } });
});

test("an invalid edition fails planner desktop acceptance with both legal values", () => {
  assert.throws(() => planPlannerAcceptanceBuild({ TICKETRY_EDITION: "full" }), /pocock.*core/);
});
