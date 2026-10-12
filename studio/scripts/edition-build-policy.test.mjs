import assert from "node:assert/strict";
import test from "node:test";

import { editionDefine, editionFeatureArguments, resolveEdition, resolveEditionBuild } from "./edition-build-policy.mjs";

test("an unset edition builds Pocock by default", () => {
  assert.deepEqual(resolveEdition({}), { edition: "pocock", source: "default" });
});

test("the exact edition literals resolve as explicit choices", () => {
  assert.deepEqual(resolveEdition({ TICKETRY_EDITION: "pocock" }), { edition: "pocock", source: "explicit" });
  assert.deepEqual(resolveEdition({ TICKETRY_EDITION: "core" }), { edition: "core", source: "explicit" });
});

test("any other edition value is refused with both legal values named", () => {
  for (const value of ["Core", "full", "", " core", "core "]) {
    assert.throws(
      () => resolveEdition({ TICKETRY_EDITION: value }),
      (error) => error.message.includes("TICKETRY_EDITION")
        && error.message.includes("pocock")
        && error.message.includes("core")
        && error.message.includes(JSON.stringify(value)),
      `refuses ${JSON.stringify(value)}`,
    );
  }
});

test("each edition compiles to its frontend define", () => {
  assert.deepEqual(editionDefine({}), { __TICKETRY_EDITION__: "\"pocock\"" });
  assert.deepEqual(editionDefine({ TICKETRY_EDITION: "pocock" }), { __TICKETRY_EDITION__: "\"pocock\"" });
  assert.deepEqual(editionDefine({ TICKETRY_EDITION: "core" }), { __TICKETRY_EDITION__: "\"core\"" });
  assert.throws(() => editionDefine({ TICKETRY_EDITION: "full" }), /pocock.*core/);
});

test("a launcher build carries the resolved edition to its frontend and Rust host", () => {
  for (const [environment, expected] of [
    [{}, { edition: "pocock", source: "default", cargoFeatures: [], description: "Edition: pocock (default)" }],
    [{ TICKETRY_EDITION: "pocock" }, { edition: "pocock", source: "explicit", cargoFeatures: [], description: "Edition: pocock (explicit)" }],
    [{ TICKETRY_EDITION: "core" }, { edition: "core", source: "explicit", cargoFeatures: ["edition-core"], description: "Edition: core (explicit)" }],
  ]) {
    const build = resolveEditionBuild({ ...environment, OTHER: "kept" });
    assert.equal(build.edition, expected.edition);
    assert.equal(build.source, expected.source);
    assert.deepEqual(build.cargoFeatures, expected.cargoFeatures);
    assert.equal(build.description, expected.description);
    assert.deepEqual(build.environment, { OTHER: "kept", TICKETRY_EDITION: expected.edition });
  }
});

test("only Core adds a Cargo feature argument, merged with any feature the caller needs", () => {
  assert.deepEqual(editionFeatureArguments(resolveEditionBuild({})), []);
  assert.deepEqual(editionFeatureArguments(resolveEditionBuild({}), ["desktop-acceptance"]), ["--features", "desktop-acceptance"]);
  assert.deepEqual(editionFeatureArguments(resolveEditionBuild({ TICKETRY_EDITION: "core" })), ["--features", "edition-core"]);
  assert.deepEqual(
    editionFeatureArguments(resolveEditionBuild({ TICKETRY_EDITION: "core" }), ["desktop-acceptance"]),
    ["--features", "desktop-acceptance,edition-core"],
  );
});

test("an invalid launcher edition is refused before any build plan exists", () => {
  assert.throws(() => resolveEditionBuild({ TICKETRY_EDITION: "full" }), /"pocock" or "core"/);
});
