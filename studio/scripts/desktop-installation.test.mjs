import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDesktopInstallation } from "./desktop-installation.mjs";

const installationModule = fileURLToPath(new URL("./desktop-installation.mjs", import.meta.url));

function fixtureDirectory(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "ticketry-installation-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const binary = path.join(directory, "ticketry");
  const hook = path.join(directory, "ticketry-hook");
  writeFileSync(binary, "#!/bin/sh\n");
  writeFileSync(hook, "#!/bin/sh\n");
  return { directory, binary, hook };
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("a scenario's own provider script becomes the approved codex executable", async (t) => {
  const fixture = fixtureDirectory(t);
  const providerScript = path.join(fixture.directory, "provider.mjs");
  writeFileSync(providerScript, `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(path.join(fixture.directory, "provider-argv.json"))}, JSON.stringify(process.argv.slice(2)));
`);
  const installation = await createDesktopInstallation({
    binary: fixture.binary,
    hookBinary: fixture.hook,
    providerScript,
    installSignalHandlers: false,
  });
  t.after(() => installation.cleanup());

  const registry = JSON.parse(readFileSync(
    path.join(installation.dataDirectory, "approved-executables.json"),
    "utf8",
  ));
  const codex = registry.tools.find((entry) => entry.tool === "codex").path;
  assert.equal(codex, installation.codex);
  assert.ok(registry.tools.some((entry) => entry.tool === "tmux" && entry.path === installation.tmux));

  const result = spawnSync(codex, ["--version", "it's quoted"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(fixture.directory, "provider-argv.json"), "utf8")),
    [installation.root, "--version", "it's quoted"],
  );

  await installation.cleanup();
  assert.equal(existsSync(installation.root), false);
});

test("an interrupt removes the private tmux server, this installation's helpers and temporary profile", async (t) => {
  const fixture = fixtureDirectory(t);
  const providerScript = path.join(fixture.directory, "provider.mjs");
  writeFileSync(providerScript, "");
  const harness = spawn(process.execPath, ["--input-type=module", "-e", `
import { spawn, spawnSync } from "node:child_process";
import { createDesktopInstallation } from ${JSON.stringify(installationModule)};
const installation = await createDesktopInstallation(${JSON.stringify({
    binary: fixture.binary,
    hookBinary: fixture.hook,
    providerScript,
  })});
const started = spawnSync(installation.tmux, ["-L", "ticketry-e2e", "new-session", "-d", "sleep 300"], {
  env: { ...process.env, ...installation.environment },
});
if (started.status !== 0) throw new Error("private tmux did not start");
const tmuxServer = spawnSync(installation.tmux, ["-L", "ticketry-e2e", "display-message", "-p", "#{pid}"], {
  env: { ...process.env, ...installation.environment }, encoding: "utf8",
}).stdout.trim();
const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", installation.root], { detached: true, stdio: "ignore" });
helper.unref();
installation.trackHelperProcesses(() => [helper.pid]);
console.log(JSON.stringify({ root: installation.root, helper: helper.pid, tmuxServer: Number(tmuxServer) }));
setInterval(() => {}, 1_000);
`], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => harness.kill("SIGKILL"));

  const [line] = await once(harness.stdout, "data");
  const ready = JSON.parse(String(line));
  t.after(() => {
    for (const pid of [ready.helper, ready.tmuxServer]) {
      if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  });
  assert.ok(existsSync(ready.root));
  assert.ok(alive(ready.helper));
  assert.ok(alive(ready.tmuxServer));

  const exited = once(harness, "exit");
  harness.kill("SIGINT");
  const [, signal] = await exited;

  assert.equal(signal, "SIGINT");
  assert.equal(existsSync(ready.root), false);
  assert.equal(alive(ready.helper), false);
  assert.equal(alive(ready.tmuxServer), false);
});

test("cleanup leaves a tracked PID alone once it no longer belongs to the installation", async (t) => {
  const fixture = fixtureDirectory(t);
  const providerScript = path.join(fixture.directory, "provider.mjs");
  writeFileSync(providerScript, "");
  const installation = await createDesktopInstallation({
    binary: fixture.binary,
    hookBinary: fixture.hook,
    providerScript,
    installSignalHandlers: false,
  });
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(() => unrelated.kill("SIGKILL"));
  await once(unrelated, "spawn");
  installation.trackHelperProcesses(() => [unrelated.pid]);

  await installation.cleanup();

  assert.equal(alive(unrelated.pid), true);
  assert.equal(existsSync(installation.root), false);
});
