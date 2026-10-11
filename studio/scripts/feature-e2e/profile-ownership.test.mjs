import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createPlaywrightProfile, cleanupPlaywrightProfile } from "../playwright-profile.mjs";

test("cleanup refuses a recycled provider PID and removes only its disposable directory", () => {
  const profile = createPlaywrightProfile();
  const id = "a".repeat(32);
  writeFileSync(join(profile.providerDirectory, `${id}.started.json`), JSON.stringify({ id, pid: process.pid }));
  const result = cleanupPlaywrightProfile(profile);
  assert.equal(result.removed, true);
  assert.deepEqual(result.terminatedProviderPids, []);
  assert.equal(existsSync(profile.dataDirectory), false);
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});
test("cleanup kills a live owned fixture group before deleting its profile", async () => {
  const profile = createPlaywrightProfile();
  const id = "b".repeat(32);
  const fixture = join(profile.providerDirectory, "sprint-provider.mjs");
  writeFileSync(fixture, "setInterval(() => {}, 1000);\n");
  const child = spawn(process.execPath, [fixture,
    "--output-last-message", join(profile.dataDirectory, "executions", id, "result.json")], { detached: true, stdio: "ignore" });
  await once(child, "spawn");
  const exited = once(child, "exit");
  try {
    writeFileSync(join(profile.providerDirectory, `${id}.started.json`), JSON.stringify({ id, pid: child.pid }));
    const result = cleanupPlaywrightProfile(profile);
    assert.equal(result.removed, true);
    assert.equal(result.clean, false, "a provider surviving server shutdown is reported as a leak");
    assert.deepEqual(result.terminatedProviderPids, [child.pid]);
    await exited;
    assert.equal(existsSync(profile.dataDirectory), false);
  } finally { child.kill("SIGKILL"); cleanupPlaywrightProfile(profile); }
});
test("cleanup closes only a web server group with the exact owned profile environment", async () => {
  const profile = createPlaywrightProfile();
  const scripts = join(profile.providerDirectory, "scripts");
  mkdirSync(scripts);
  const fixture = join(scripts, "web-dev.mjs");
  writeFileSync(fixture, "console.log('ready'); setInterval(() => {}, 1000);\n");
  const start = (dataDirectory) => spawn(process.execPath, [fixture], {
    env: { ...process.env, MUXED_DATA_DIR: dataDirectory }, detached: true, stdio: ["ignore", "pipe", "ignore"],
  });
  const owned = start(profile.dataDirectory);
  const foreign = start(`${profile.dataDirectory}-different`);
  try {
    await Promise.all([once(owned.stdout, "data"), once(foreign.stdout, "data")]);
    const exited = once(owned, "exit");
    const result = cleanupPlaywrightProfile(profile);
    assert.deepEqual(result.terminatedWebServerPids, [owned.pid]);
    assert.equal(result.clean, false);
    await exited;
    assert.doesNotThrow(() => process.kill(foreign.pid, 0));
  } finally {
    owned.kill("SIGKILL"); foreign.kill("SIGKILL"); cleanupPlaywrightProfile(profile);
  }
});
