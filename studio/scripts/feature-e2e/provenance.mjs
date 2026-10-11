import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.error?.message ?? (result.stderr || `exit ${result.status}`)}`);
  return result.stdout;
}

/** Sorted paths preserve deterministic comparisons, including additions/deletions. */
export function sourceHashes(root) {
  const paths = new Set(git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean));
  const hashes = {};
  for (const file of [...paths].sort()) {
    const path = join(root, file);
    let stat;
    try { stat = lstatSync(path); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (stat.isDirectory()) continue;
    const bytes = stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path);
    hashes[file] = createHash("sha256").update(bytes).digest("hex");
  }
  return hashes;
}


export function snapshotProvenance(root, runDirectory) {
  const revision = git(root, ["rev-parse", "HEAD"]).trim();
  const dirty = Boolean(git(root, ["status", "--porcelain"]).trim());
  const hashes = sourceHashes(root);
  mkdirSync(runDirectory, { recursive: true });
  writeFileSync(join(runDirectory, "working-tree.patch"), git(root, ["diff", "--binary", "HEAD"]));
  writeFileSync(join(runDirectory, "source-sha256.json"), `${JSON.stringify(hashes, null, 2)}\n`);
  return { revision, dirty, sourceHashes: hashes };
}
