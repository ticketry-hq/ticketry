import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWebHookRunnerCommand, graphqlAdapterCargoArguments } from "../../../scripts/web-dev.mjs";
import { prepareStackProfile, stackServerEnvironment } from "./stackProfile.mjs";
import { acquireStackSlot, slotWaitReporter } from "./stackSlots.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const readyTimeoutMs = 600_000;
const stopTimeoutMs = 10_000;

/**
 * Builds the hook runner and GraphQL adapter once per run, with the same Cargo
 * arguments `bun run web` uses so both share artifacts. Returns null when the
 * binaries are unavailable; servers then fall back to `cargo run` per launch.
 */
export function buildStackBinaries({ root = repositoryRoot, run = spawnSync } = {}) {
  const hook = buildWebHookRunnerCommand({ cwd: root });
  const adapterBinary = join(root, "studio", "src-tauri", "target", "debug", "ticketry_graphql_adapter");
  for (const [command, args] of [[hook.command, hook.args], ["cargo", ["build", ...graphqlAdapterCargoArguments]]]) {
    const result = run(command, args, { cwd: root, stdio: "inherit" });
    if (result.error || result.status !== 0) return null;
  }
  return existsSync(hook.output) && existsSync(adapterBinary) ? { adapterBinary, hookRunner: hook.output } : null;
}

async function waitUntilServing(url, exited, shouldStop) {
  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (shouldStop()) throw new Error("Stopped while the e2e server was starting");
    const exit = exited();
    if (exit) throw new Error(`e2e server exited with ${exit} before serving ${url}; see web-server.log`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`e2e server did not serve ${url} within ${readyTimeoutMs / 1000}s`);
}

/**
 * Starts `scripts/web-dev.mjs` for one runner-owned profile once the machine-wide
 * queue admits it, and resolves when the frontend serves. The process group
 * leader is web-dev itself, which is what profile cleanup recognises.
 */
export async function startStackServer({ owner, setup, binaries, environment = process.env, shouldStop = () => false }) {
  const slot = await acquireStackSlot({ owner, onWait: slotWaitReporter(owner), shouldStop });
  let child;
  let childClosed = Promise.resolve();
  let exit = null;
  const log = createWriteStream(join(setup.artifactDirectory, "web-server.log"));
  const logClosed = new Promise((resolve) => { log.once("close", resolve); });
  const stop = async () => {
    if (child && exit === null) {
      try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* exited */ } }, stopTimeoutMs);
      await childClosed;
      clearTimeout(timer);
    }
    // Close only after the child's output streams end, so no late write is lost.
    await childClosed;
    if (!log.writableEnded) log.end();
    await logClosed;
    slot.release();
  };
  try {
    const { providerDirectory } = prepareStackProfile(setup.profile.dataDirectory);
    child = spawn(process.execPath, ["scripts/web-dev.mjs"], {
      cwd: repositoryRoot,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...environment,
        ...stackServerEnvironment({
          dataDirectory: setup.profile.dataDirectory, providerDirectory,
          frontendPort: setup.frontendPort, adapterPort: setup.owned.TICKETRY_E2E_ADAPTER_PORT,
        }),
        ...(binaries ? {
          TICKETRY_GRAPHQL_ADAPTER_BINARY: binaries.adapterBinary,
          TICKETRY_GRAPHQL_ADAPTER_HOOK_RUNNER: binaries.hookRunner,
        } : {}),
      },
    });
    child.once("exit", (code, signal) => { exit = signal ?? `code ${code}`; });
    childClosed = new Promise((resolve) => child.once("close", resolve));
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    await waitUntilServing(`http://127.0.0.1:${setup.frontendPort}`, () => exit, shouldStop);
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
