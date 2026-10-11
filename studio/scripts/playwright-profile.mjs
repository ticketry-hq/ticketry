import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

/** A runner owns this profile; Playwright workers only inherit its identity. */
export function createPlaywrightProfile({ temporaryRoot = tmpdir() } = {}) {
  const dataDirectory = mkdtempSync(join(resolve(temporaryRoot), "ticketry-e2e-"));
  const providerDirectory = join(dataDirectory, "provider-fixture");
  mkdirSync(providerDirectory);
  return {
    dataDirectory,
    providerDirectory,
    tmuxSocket: `ticketry-e2e-${basename(dataDirectory)}`,
  };
}

/** Kill only a fixture whose live command still binds this execution result. */
export function cleanupPlaywrightProfile(profile) {
  const terminatedProviderPids = [];
  const terminatedWebServerPids = [];
  const errors = [];
  // Playwright starts its web server in a separate process group. A launcher
  // blocked in a synchronous Cargo build can outlive a cancelled test runner.
  const listing = spawnSync("ps", ["-ax", "-ww", "-o", "pid=,command="], { encoding: "utf8" });
  const escapedDirectory = profile.dataDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ownedEnvironment = new RegExp(`(?:^|\\s)MUXED_DATA_DIR=${escapedDirectory}(?:\\s|$)`);
  for (const line of (listing.stdout ?? "").split("\n")) {
    if (!line.includes("scripts/web-dev.mjs")) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (!Number.isSafeInteger(pid) || pid <= 1) continue;
    const detail = spawnSync("ps", ["eww", "-p", String(pid), "-o", "pgid=,command="], { encoding: "utf8" });
    const group = Number(detail.stdout?.trim().split(/\s+/)[0]);
    if (detail.status !== 0 || group !== pid || !ownedEnvironment.test(detail.stdout)) continue;
    try { process.kill(-group, "SIGKILL"); terminatedWebServerPids.push(pid); }
    catch (error) { if (error.code !== "ESRCH") errors.push(error.message); }
  }
  let markers = [];
  try { markers = readdirSync(profile.providerDirectory).filter((name) => name.endsWith(".started.json")); }
  catch (error) { if (error.code !== "ENOENT") errors.push(error.message); }
  for (const marker of markers) {
    try {
      const { id, pid } = JSON.parse(readFileSync(join(profile.providerDirectory, marker), "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 1 || !/^[a-f0-9]{32}$/.test(id) || marker !== `${id}.started.json`) continue;
      const expectedResult = join(profile.dataDirectory, "executions", id, "result.json");
      const command = spawnSync("ps", ["-ww", "-p", String(pid), "-o", "command="], { encoding: "utf8" });
      if (command.status !== 0 || !command.stdout.includes("sprint-provider.mjs")
          || !command.stdout.includes(expectedResult)) continue;
      try { process.kill(-pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") process.kill(pid, "SIGKILL"); }
      terminatedProviderPids.push(pid);
    } catch (error) { if (error.code !== "ESRCH") errors.push(error.message); }
  }
  const tmux = spawnSync("tmux", ["-L", profile.tmuxSocket, "kill-server"], { encoding: "utf8" });
  if (tmux.error) errors.push(tmux.error.message);
  const sessions = spawnSync("tmux", ["-L", profile.tmuxSocket, "list-sessions"], { encoding: "utf8" });
  if (sessions.status === 0) errors.push("The isolated tmux server survived cleanup.");
  try { rmSync(profile.dataDirectory, { recursive: true, force: true }); }
  catch (error) { errors.push(error.message); }
  return { removed: errors.length === 0, clean: errors.length === 0 && terminatedProviderPids.length === 0 && terminatedWebServerPids.length === 0,
    terminatedProviderPids, terminatedWebServerPids, errors };
}
