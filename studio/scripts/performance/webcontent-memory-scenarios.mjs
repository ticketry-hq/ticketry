#!/usr/bin/env node
/**
 * Matched WebContent memory captures against the packaged application.
 *
 * The comparison this investigation needs is "the same window, with and without
 * run viewers", so both scenarios run against one launch recipe: an isolated
 * data directory and a private tmux server, so nothing here touches the
 * developer's live workspace, database or durable run sessions.
 *
 * Reuses `native-view-retention-benchmark.mjs`'s launch and viewer-creation
 * path rather than inventing a second way to drive the packaged app.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveWebContentProcess } from "../../performance/webcontent/attribution.mjs";
import { readProcessTable } from "../../performance/webcontent/host.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const captureScript = path.join(scriptDirectory, "webcontent-memory.mjs");

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  const killed = once(child, "exit");
  child.kill("SIGKILL");
  await killed;
}

/**
 * Launch the packaged application against a throwaway workspace.
 *
 * The release artifact exposes no WebDriver endpoint — that is a development
 * capability — so readiness is established from the outside, by waiting for the
 * content process WebKit spawns for the window. That is the same signal the
 * capture attributes on, so a launch that never renders fails here rather than
 * producing an empty capture.
 */
export async function launchIsolatedPackagedApp(appPath, label) {
  const root = await mkdtemp(`/tmp/ticketry-webcontent-${label}-`);
  const dataDirectory = path.join(root, "data");
  const runtimeDirectory = path.join(root, "runtime");
  await Promise.all([mkdir(dataDirectory), mkdir(runtimeDirectory)]);
  const executable = path.join(appPath, "Contents", "MacOS", "ticketry");
  await access(executable);
  const child = spawn(executable, [], {
    cwd: root,
    env: {
      ...process.env,
      MUXED_DATA_DIR: dataDirectory,
      MUXED_FORCE_SQLITE: "true",
      MUXED_TMUX_SOCKET: `ticketry-webcontent-${label}-${process.pid}`,
      TMUX_TMPDIR: runtimeDirectory,
      TMPDIR: runtimeDirectory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume();
  child.stderr.resume();
  const close = async () => {
    await stopProcess(child);
    await rm(root, { recursive: true, force: true });
  };
  try {
    await waitForWebContent(child, executable);
    return { pid: child.pid, executable, dataDirectory, close };
  } catch (error) {
    // A launch that failed still left a window process behind; never leak it.
    await close();
    throw error;
  }
}

async function waitForWebContent(child, executable, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`packaged Ticketry exited during launch (${child.exitCode})`);
    }
    const table = await readProcessTable();
    const resolved = resolveWebContentProcess({
      processTable: table,
      guiPid: child.pid,
      expectedGuiCommand: executable,
    });
    if (resolved.pid) return resolved;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("no WebKit content process appeared for the packaged window");
}

function runCapture(options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [captureScript, "capture", ...options], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`capture exited ${code}`)));
  });
}

async function main(args) {
  const appPath = args.includes("--app")
    ? args[args.indexOf("--app") + 1]
    : "/Applications/Ticketry.app";
  const outputDirectory = path.resolve(
    args.includes("--output-dir") ? args[args.indexOf("--output-dir") + 1] : "webcontent-captures",
  );
  const seconds = args.includes("--seconds") ? args[args.indexOf("--seconds") + 1] : "120";
  const settle = args.includes("--settle-seconds")
    ? args[args.indexOf("--settle-seconds") + 1] : "30";
  await mkdir(outputDirectory, { recursive: true });

  const name = args.includes("--scenario")
    ? args[args.indexOf("--scenario") + 1] : "packaged-isolated-empty-workspace";
  process.stderr.write(`\n=== ${name} ===\n`);
  const app = await launchIsolatedPackagedApp(appPath, name);
  try {
    await runCapture([
      "--executable", app.executable,
      "--gui-pid", String(app.pid),
      "--scenario", name,
      "--workload",
      "packaged release window against a throwaway empty workspace: no project data, "
      + "no agent runs, no run viewers, no document open, private tmux server",
      "--seconds", seconds,
      "--interval-ms", "2000",
      "--settle-seconds", settle,
      "--visible-viewers", "0",
      "--retained-viewers", "0",
      "--active-runs", "0",
      "--document-state", "no document open",
      "--stacks",
      "--output", path.join(outputDirectory, `${name}.json`),
    ]);
  } finally {
    await app.close();
  }
  process.stdout.write(`${outputDirectory}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
