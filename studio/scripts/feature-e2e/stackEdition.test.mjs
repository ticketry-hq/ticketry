import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { buildWebHookRunnerCommand } from "../../../scripts/web-dev.mjs";
import { resolveEditionBuild } from "../edition-build-policy.mjs";
import { buildStackBinaries } from "./stackServer.mjs";
import { stackServerEnvironment } from "./stackProfile.mjs";

const adapterBuild = (environment) => {
  const calls = [];
  buildStackBinaries({ root: "/repo", editionBuild: resolveEditionBuild(environment), run: (command, args) => { calls.push([command, ...args]); return { status: 0 }; } });
  return calls.find((call) => call[0] === "cargo" && call.includes("ticketry_graphql_adapter"));
};

test("the prebuilt adapter compiles the runner's edition", () => {
  assert.equal(adapterBuild({}).includes("--features"), false);
  const core = adapterBuild({ TICKETRY_EDITION: "core" });
  assert.deepEqual(core.slice(core.indexOf("--features"), core.indexOf("--features") + 2), ["--features", "edition-core"]);
});

test("every e2e web server is told the edition to compile", () => {
  const profile = { dataDirectory: "/tmp/profile", providerDirectory: "/tmp/profile/provider", frontendPort: 1, adapterPort: 2 };
  assert.equal(stackServerEnvironment({ ...profile, edition: "core" }).TICKETRY_EDITION, "core");
  assert.equal(stackServerEnvironment({ ...profile, edition: "pocock" }).TICKETRY_EDITION, "pocock");
});

test("each edition's servers start their own adapter copy, so concurrent runs of the other edition cannot swap it", () => {
  for (const edition of ["pocock", "core"]) {
    const copies = [];
    const binaries = buildStackBinaries({
      root: "/repo", editionBuild: resolveEditionBuild({ TICKETRY_EDITION: edition }), run: () => ({ status: 0 }),
      exists: () => true, copy: (from, to) => copies.push([from, to]),
    });
    const editionBinary = `/repo/studio/src-tauri/target/debug/e2e-${edition}/ticketry_graphql_adapter`;
    assert.deepEqual(copies, [["/repo/studio/src-tauri/target/debug/ticketry_graphql_adapter", editionBinary]]);
    assert.equal(binaries.adapterBinary, editionBinary);
  }
});

test("refreshing an edition's adapter copy replaces the file instead of rewriting a binary servers may be running", () => {
  const root = mkdtempSync(join(tmpdir(), "stack-binaries-"));
  try {
    const debug = join(root, "studio/src-tauri/target/debug");
    const hook = buildWebHookRunnerCommand({ cwd: root }).output;
    const running = join(debug, "e2e-pocock/ticketry_graphql_adapter");
    for (const [path, content] of [[hook, "hook"], [join(debug, "ticketry_graphql_adapter"), "new"], [running, "old"]]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    const before = statSync(running).ino;
    const binaries = buildStackBinaries({ root, editionBuild: resolveEditionBuild({}), run: () => ({ status: 0 }) });
    assert.equal(binaries.adapterBinary, running);
    assert.equal(readFileSync(running, "utf8"), "new");
    assert.notEqual(statSync(running).ino, before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
