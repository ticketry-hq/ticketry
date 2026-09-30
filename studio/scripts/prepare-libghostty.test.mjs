import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("preparation only reuses a library built with the current crash-reporting recipe", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ticketry-ghostty-recipe-"));
  try {
    const scripts = path.join(root, "scripts");
    const vendor = path.join(root, "src-tauri/vendor/libghostty");
    const bin = path.join(root, "bin");
    for (const dir of [scripts, bin, `${vendor}/include`, `${vendor}/lib`,
      `${vendor}/resources/ghostty`, `${vendor}/resources/terminfo`]) {
      mkdirSync(dir, { recursive: true });
    }
    for (const name of ["prepare-libghostty.sh", "libghostty-macos-static.patch"]) {
      cpSync(new URL(name, import.meta.url), path.join(scripts, name));
    }
    writeFileSync(`${bin}/uname`, '#!/bin/sh\ncase "$1" in -s) echo Darwin;; -m) echo arm64;; esac\n', { mode: 0o755 });
    // A stale artifact must try preparing instead of returning it. Stop at
    // the first download so this test needs neither network nor a compiler.
    writeFileSync(`${bin}/curl`, "#!/bin/sh\necho REBUILD_REQUIRED >&2\nexit 87\n", { mode: 0o755 });
    writeFileSync(`${vendor}/REVISION`, "332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28\n");
    writeFileSync(`${vendor}/include/ghostty.h`, "fixture");
    writeFileSync(`${vendor}/lib/libghostty.a`, "fixture");
    const run = () => execFileSync("sh", [`${scripts}/prepare-libghostty.sh`], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MUXED_LIBGHOSTTY_CACHE_DIR: `${root}/cache` },
      encoding: "utf8", stdio: "pipe",
    });
    const requiresRebuild = () => assert.throws(run, error =>
      error.status === 87 && error.stderr.includes("REBUILD_REQUIRED"));
    requiresRebuild();
    writeFileSync(`${vendor}/BUILD_RECIPE`, "old-recipe\n");
    requiresRebuild();
    const hash = createHash("sha256")
      .update(readFileSync(`${scripts}/prepare-libghostty.sh`))
      .update(readFileSync(`${scripts}/libghostty-macos-static.patch`)).digest("hex");
    writeFileSync(`${vendor}/BUILD_RECIPE`, `${hash}\n`);
    assert.match(run(), /is current/);
    writeFileSync(`${scripts}/libghostty-macos-static.patch`, "changed-patch\n");
    requiresRebuild();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
