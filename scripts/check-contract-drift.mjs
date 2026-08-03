import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import { findStaleContractArtifacts } from "./contract-drift.mjs";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(resolve(tmpdir(), "worktracker-contract-"));
const tempSchema = resolve(temp, "openapi.json");
const tempTypescriptGenerated = resolve(temp, "typescript-generated");
const tempPythonGenerated = resolve(temp, "python-generated");
const tempWireSchema = resolve(temp, "wire-frames.schema.json");
const serverDir = resolve(root, "backend");

// The terminal WS frames are declared in ticketry's Django backend, not in the
// worktracker package. Its
// committed JSON-Schema artifact (#692) is re-exported and diffed below, the
// same way the OpenAPI/SDK pair is — when the backend checkout is present.
const localServerPython = resolve(serverDir, ".venv", "bin", "python");
const serverPython =
  process.env.MUXED_SERVER_PYTHON ||
  (existsSync(localServerPython) ? localServerPython : null);
const committedWireSchema = resolve(
  root,
    "studio",
    "src",
    "shared",
    "api",
    "transport",
  "wire-frames.schema.json",
);

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

if (serverPython) {
  run(serverPython, ["manage.py", "export_wire_frames", tempWireSchema], {
    cwd: serverDir,
    env: {
      ...process.env,
      MUXED_STATE_DB: resolve(temp, "state.db"),
    },
  });
} else {
  console.warn(
    "Skipping WS wire-frame drift check: ticketry backend checkout not found " +
      `(looked for ${localServerPython}). Set MUXED_SERVER_PYTHON to enable.`,
  );
}

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

if (serverPython) {
  const wireDiff = spawnSync("diff", ["-u", committedWireSchema, tempWireSchema], {
    encoding: "utf8",
  });
  if (wireDiff.status !== 0) {
    stale.push("studio/src/shared/api/transport/wire-frames.schema.json");
  }
}

rmSync(temp, { recursive: true, force: true });

if (stale.length) {
  console.error(`Contract drift: ${stale.join(", ")}`);
  console.error("Run: npm run contract:generate");
  process.exit(1);
}
console.log("Contract artifacts are current.");
