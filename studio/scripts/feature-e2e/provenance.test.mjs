import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { git, sourceHashes } from "./provenance.mjs";

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "feature-provenance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  spawnSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), "ignored/\n");
  writeFileSync(join(root, "tracked.txt"), "initial\n");
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "initial"]);
  return root;
}

test("source snapshots detect modified, untracked, deleted and symlink sources", (t) => {
  const root = repository(t);
  const before = sourceHashes(root);
  assert.equal(before["tracked.txt"], "da68f54607d5f5644954096ce1597c006c5bb9f2497e07441bf064b81003ef8a");
  writeFileSync(join(root, "new.txt"), "new");
  symlinkSync("missing-target", join(root, "link"));
  const after = sourceHashes(root);
  assert.ok(after["new.txt"]);
  assert.ok(after.link);
  assert.notDeepEqual(after, before);
  rmSync(join(root, "tracked.txt"));
  assert.equal(sourceHashes(root)["tracked.txt"], undefined);
});

test("provenance preserves revision, dirty patch and source snapshot", async (t) => {
  const { snapshotProvenance } = await import("./provenance.mjs");
  const root = repository(t);
  const evidence = mkdtempSync(join(tmpdir(), "feature-evidence-"));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  const clean = snapshotProvenance(root, evidence);
  assert.equal(clean.dirty, false);
  assert.equal(clean.revision.length, 40);
  writeFileSync(join(root, "tracked.txt"), "modified\n");
  const dirty = snapshotProvenance(root, evidence);
  assert.equal(dirty.dirty, true);
  assert.match(readFileSync(join(evidence, "working-tree.patch"), "utf8"), /\+modified/);
  assert.deepEqual(JSON.parse(readFileSync(join(evidence, "source-sha256.json"), "utf8")), dirty.sourceHashes);
  assert.notDeepEqual(clean.sourceHashes, dirty.sourceHashes);
});
