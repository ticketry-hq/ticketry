import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { replaceInstalledApp, stagedAppPath } from "./desktop-deploy.mjs";

test("stagedAppPath resolves the verified release output", () => {
  assert.equal(
    stagedAppPath(
      { release_version: "1.2.3" },
      { id: "macos-aarch64" },
      "/repo/studio",
    ),
    "/repo/studio/release-output/1.2.3/macos-aarch64/Ticketry.app",
  );
});

test("replaceInstalledApp swaps in the build and removes its temporary backup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ticketry-deploy-"));
  const source = path.join(root, "release", "Ticketry.app");
  const destination = path.join(root, "Applications", "Ticketry.app");
  await Promise.all([
    mkdir(source, { recursive: true }),
    mkdir(destination, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(source, "version"), "new"),
    writeFile(path.join(destination, "version"), "old"),
  ]);

  try {
    await replaceInstalledApp(source, destination);
    assert.equal(await readFile(path.join(destination, "version"), "utf8"), "new");
    await assert.rejects(
      readFile(`${destination}.previous-${process.pid}`),
      /ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("replaceInstalledApp restores the previous app when the final move fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ticketry-deploy-rollback-"));
  const source = path.join(root, "release", "Ticketry.app");
  const destination = path.join(root, "Applications", "Ticketry.app");
  await Promise.all([
    mkdir(source, { recursive: true }),
    mkdir(destination, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(source, "version"), "new"),
    writeFile(path.join(destination, "version"), "old"),
  ]);

  let moveCount = 0;
  const move = async (...args) => {
    moveCount += 1;
    if (moveCount === 2) throw new Error("simulated install failure");
    const { rename } = await import("node:fs/promises");
    return rename(...args);
  };

  try {
    await assert.rejects(
      replaceInstalledApp(source, destination, { move }),
      /could not replace.*simulated install failure/,
    );
    assert.equal(await readFile(path.join(destination, "version"), "utf8"), "old");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
