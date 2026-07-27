import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { findStaleContractArtifacts } from "./contract-drift.mjs";

const writeArtifact = (path, content) => {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "artifact.txt"), content);
};

const createFixture = (prefix) => {
  const fixture = mkdtempSync(join(tmpdir(), prefix));
  const committedSchema = join(fixture, "openapi.json");
  const generatedSchema = join(fixture, "generated-openapi.json");
  const committedTypescript = join(fixture, "committed-typescript");
  const generatedTypescript = join(fixture, "generated-typescript");
  const committedPython = join(fixture, "committed-python");
  const generatedPython = join(fixture, "generated-python");

  writeFileSync(committedSchema, "schema\n");
  writeFileSync(generatedSchema, "schema\n");
  writeArtifact(committedTypescript, "typescript\n");
  writeArtifact(generatedTypescript, "typescript\n");
  writeArtifact(committedPython, "python\n");
  writeArtifact(generatedPython, "python\n");

  return {
    fixture,
    paths: {
      committedSchema,
      generatedSchema,
      committedTypescript,
      generatedTypescript,
      committedPython,
      generatedPython,
    },
  };
};

test("Python SDK drift participates in the contract artifact check", () => {
  const { fixture, paths } = createFixture("worktracker-contract-drift-");

  try {
    assert.deepEqual(findStaleContractArtifacts(paths), []);

    writeArtifact(paths.generatedPython, "drifted python\n");
    assert.deepEqual(findStaleContractArtifacts(paths), [
      "surfaces/worktracker-sdk/worktracker_sdk/generated",
    ]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("Python SDK drift ignores interpreter cache files", () => {
  const { fixture, paths } = createFixture("worktracker-contract-cache-");
  const cache = join(paths.committedPython, "__pycache__");
  mkdirSync(cache);
  writeFileSync(join(cache, "module.pyc"), "cache\n");

  try {
    assert.deepEqual(findStaleContractArtifacts(paths), []);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
