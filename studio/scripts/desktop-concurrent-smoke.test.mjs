import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runConcurrentDevelopmentSmoke } from "./desktop-concurrent-smoke.mjs";

test("two worktree fixtures stay isolated through readiness and independent shutdown", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "muxed-concurrent-smoke-"));
  const fixtures = ["alpha", "bravo"].map((name) => ({
    name,
    cwd: path.join(root, name),
    dataDirectory: path.join(root, `${name}-data`),
  }));

  try {
    const result = await runConcurrentDevelopmentSmoke({
      fixtures,
      command: process.execPath,
      args: [new URL("./fixtures/isolated-development-instance.mjs", import.meta.url).pathname],
      timeoutMs: 10_000,
    });

    assert.notEqual(result.alpha.frontend, result.bravo.frontend);
    assert.notEqual(result.alpha.backend, result.bravo.backend);
    assert.notEqual(result.alpha.mcp, result.bravo.mcp);
    assert.notEqual(result.alpha.dataDirectory, result.bravo.dataDirectory);
    assert.equal(result.alpha.frontendMarker, "alpha");
    assert.equal(result.bravo.frontendMarker, "bravo");
    assert.equal(result.alpha.backendOwner, "alpha");
    assert.equal(result.bravo.backendOwner, "bravo");
    assert.equal(result.alpha.mcpOwner, "alpha");
    assert.equal(result.bravo.mcpOwner, "bravo");
    assert.equal(result.survivorAfterFirstShutdown, "bravo");

    await assert.rejects(readFile(path.join(fixtures[1].dataDirectory, "alpha-sentinel")));
    assert.equal(
      await readFile(path.join(fixtures[0].dataDirectory, "alpha-sentinel"), "utf8"),
      "alpha",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
