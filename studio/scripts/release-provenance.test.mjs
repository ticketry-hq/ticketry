import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { releaseTauriBuildEnvironment } from "./release-build.mjs";

const head = "0123456789abcdef0123456789abcdef01234567";
const execFileAsync = promisify(execFile);
const studioRoot = fileURLToPath(new URL("..", import.meta.url));

test("the Rust build boundary enforces release provenance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ticketry-build-provenance-"));
  const binary = path.join(directory, "tests");
  try {
    await execFileAsync("rustc", [
      "--edition=2021",
      "--test",
      path.join(studioRoot, "src-tauri", "build_provenance.rs"),
      "-o",
      binary,
    ]);
    await execFileAsync(binary);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("clean release builds stamp the current HEAD", async () => {
  assert.equal(
    (await releaseTauriBuildEnvironment({}, {
      capture: async (_command, args) => args[0] === "status" ? "" : head,
    })).TICKETRY_COMMIT,
    head,
  );
});

test("release builds reject dirty source trees", async () => {
  await assert.rejects(
    releaseTauriBuildEnvironment({}, {
      capture: async (_command, args) => args[0] === "status" ? " M src/main.rs" : head,
    }),
    /source tree is dirty/,
  );
});

test("unsigned local builds may stamp HEAD from a dirty source tree", async () => {
  assert.equal(
    (await releaseTauriBuildEnvironment({}, {
      allowDirty: true,
      capture: async (_command, args) => args[0] === "status" ? " M src/main.rs" : head,
    })).TICKETRY_COMMIT,
    head,
  );
});

test("release builds reject invalid explicit commits", async () => {
  for (const commit of ["", "unknown", "release-candidate"]) {
    await assert.rejects(
      releaseTauriBuildEnvironment({ TICKETRY_COMMIT: commit }, {
        capture: async (_command, args) => args[0] === "status" ? "" : head,
      }),
      /release commit must be a full Git object ID/,
    );
  }
});

test("release builds reject an explicit commit that is not HEAD", async () => {
  const other = "89abcdef0123456789abcdef0123456789abcdef";
  await assert.rejects(
    releaseTauriBuildEnvironment({ TICKETRY_COMMIT: other }, {
      capture: async (_command, args) => args[0] === "status" ? "" : head,
    }),
    /explicit release commit does not match HEAD/,
  );
});
