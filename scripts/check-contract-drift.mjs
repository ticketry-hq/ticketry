import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import { findStaleContractArtifacts } from "./contract-drift.mjs";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(resolve(tmpdir(), "worktracker-contract-"));
const tempSchema = resolve(temp, "openapi.json");
const tempTypescriptGenerated = resolve(temp, "typescript-generated");
const tempPythonGenerated = resolve(temp, "python-generated");

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(process.execPath, [resolve(root, "scripts/export-openapi.mjs")], {
  env: {
    ...process.env,
    WORKTRACKER_OPENAPI_DESTINATION: tempSchema,
  },
});
run(process.execPath, [resolve(root, "scripts/generate-typescript-sdk.mjs")], {
  env: {
    ...process.env,
    WORKTRACKER_GENERATED_DIR: tempTypescriptGenerated,
  },
});
run(process.execPath, [resolve(root, "scripts/generate-python-sdk.mjs")], {
  env: {
    ...process.env,
    WORKTRACKER_OPENAPI_SCHEMA: tempSchema,
    WORKTRACKER_PYTHON_GENERATED_DIR: tempPythonGenerated,
  },
});

const stale = findStaleContractArtifacts({
  committedSchema: resolve(root, "openapi.json"),
  generatedSchema: tempSchema,
  committedTypescript: resolve(
    root,
    "surfaces",
    "worktracker-typescript-sdk",
    "src",
    "generated",
  ),
  generatedTypescript: tempTypescriptGenerated,
  committedPython: resolve(
    root,
    "surfaces",
    "worktracker-sdk",
    "worktracker_sdk",
    "generated",
  ),
  generatedPython: tempPythonGenerated,
});

rmSync(temp, { recursive: true, force: true });

if (stale.length) {
  console.error(`Contract drift: ${stale.join(", ")}`);
  console.error("Run: npm run contract:generate");
  process.exit(1);
}
console.log("Contract artifacts are current.");
