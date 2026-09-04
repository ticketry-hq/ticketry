#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { remote } from "webdriverio";

import {
  analyzeCaptureSet,
  renderReport,
} from "./native-view-resource-measurement.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const measurementScript = path.join(scriptDirectory, "native-view-resource-measurement.mjs");
const requiredCounts = [1, 5, 20];
const settlingMilliseconds = 120_000;
const benchmarkFrame = {
  x: 16,
  y: 80,
  width: 960,
  height: 600,
  viewportWidth: 1200,
  viewportHeight: 800,
};

function assertBenchmarkStatus(count, status) {
  if (status?.requestedCount !== count
    || status?.createdCount !== count
    || status?.visibleCount !== 1
    || status?.selectedCount !== 1
    || status?.hiddenCount !== count - 1) {
    throw new Error(`benchmark did not prove the requested native-view state: ${JSON.stringify(status)}`);
  }
}

export async function runPackagedRetentionBenchmark({
  counts = requiredCounts,
  openScenario,
  captureScenario,
  settleScenario = async () => {},
}) {
  const captures = [];
  for (const count of counts) {
    const scenario = await openScenario(count);
    try {
      assertBenchmarkStatus(count, scenario.status);
      await settleScenario(count, scenario);
      captures.push(await captureScenario({
        count,
        pid: scenario.pid,
        executable: scenario.executable,
      }));
    } finally {
      await scenario.close();
    }
  }
  return captures;
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForPort(port, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`packaged Ticketry exited before WebDriver started (${child.exitCode})`);
    }
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("packaged Ticketry did not expose its WebDriver endpoint");
}

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

async function invokeBenchmark(browser, count) {
  return browser.execute(async (requestedCount, frame) => {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals?.invoke) throw new Error("Tauri invoke bridge is unavailable");
    return internals.invoke("native_terminal_retention_benchmark", {
      count: requestedCount,
      frame,
    });
  }, count, benchmarkFrame);
}

export async function openPackagedScenario(appPath, count) {
  const root = await mkdtemp(`/tmp/ticketry-native-retention-${count}-`);
  const dataDirectory = path.join(root, "data");
  const runtimeDirectory = path.join(root, "runtime");
  await Promise.all([mkdir(dataDirectory), mkdir(runtimeDirectory)]);
  const executable = path.join(appPath, "Contents", "MacOS", "ticketry");
  await access(executable);
  const port = await availablePort();
  const stdout = [];
  const stderr = [];
  const child = spawn(executable, [], {
    cwd: root,
    env: {
      ...process.env,
      MUXED_DATA_DIR: dataDirectory,
      MUXED_FORCE_SQLITE: "true",
      MUXED_TMUX_SOCKET: `ticketry-native-retention-${count}-${process.pid}`,
      TMUX_TMPDIR: runtimeDirectory,
      TMPDIR: runtimeDirectory,
      TAURI_WEBDRIVER_PORT: String(port),
      TICKETRY_NATIVE_RETENTION_BENCHMARK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  let browser;
  try {
    await waitForPort(port, child);
    browser = await remote({
      hostname: "127.0.0.1",
      port,
      logLevel: "warn",
      capabilities: { "wdio:tauriServiceOptions": { windowLabel: "main" } },
    });
    if (await browser.getUrl() === "about:blank") await browser.url("tauri://localhost/");
    await browser.waitUntil(
      async () => browser.execute(() => document.readyState === "complete"),
      { timeout: 30_000, timeoutMsg: "packaged Studio document did not finish loading" },
    );
    const status = await invokeBenchmark(browser, count);
    return {
      pid: child.pid,
      executable,
      status,
      async keepAlive() {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            `packaged Ticketry exited during settling (${child.exitCode ?? child.signalCode})`,
          );
        }
        await browser.execute(() => document.readyState);
      },
      async close() {
        await invokeBenchmark(browser, 0).catch(() => {});
        await browser.deleteSession().catch(() => {});
        await stopProcess(child);
        if (process.env.TICKETRY_KEEP_NATIVE_RETENTION === "1") {
          await Promise.all([
            writeFile(path.join(root, "ticketry.stdout.log"), Buffer.concat(stdout)),
            writeFile(path.join(root, "ticketry.stderr.log"), Buffer.concat(stderr)),
          ]);
          process.stderr.write(`Retained native benchmark diagnostics: ${root}\n`);
        } else {
          await rm(root, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await Promise.all([
      writeFile(path.join(root, "ticketry.stdout.log"), Buffer.concat(stdout)),
      writeFile(path.join(root, "ticketry.stderr.log"), Buffer.concat(stderr)),
    ]).catch(() => {});
    if (browser) await browser.deleteSession().catch(() => {});
    await stopProcess(child);
    throw new Error(`${error.message}; retained diagnostics: ${root}`);
  }
}

export async function runCapture({ outputDirectory, count, pid, executable, seconds }) {
  const output = path.join(outputDirectory, `native-views-${count}.json`);
  const child = spawn(process.execPath, [
    measurementScript,
    "capture",
    "--pid", String(pid),
    "--executable", executable,
    "--views", String(count),
    "--visible", "1",
    "--selected", "1",
    "--seconds", String(seconds),
    "--interval-ms", "1000",
    "--workload", "idle /bin/cat after 120 second settling period",
    "--output", output,
  ], { stdio: "inherit" });
  const [code, signal] = await once(child, "exit");
  if (code !== 0) throw new Error(`resource capture failed (${code ?? signal})`);
  return JSON.parse(await readFile(output, "utf8"));
}

function requiredOption(args, name) {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(args) {
  if (process.platform !== "darwin") throw new Error("native retention benchmark requires macOS");
  const appPath = path.resolve(requiredOption(args, "--app"));
  const outputDirectory = path.resolve(requiredOption(args, "--output-dir"));
  const secondsIndex = args.indexOf("--seconds");
  const seconds = Number(secondsIndex === -1 ? 60 : args[secondsIndex + 1]);
  if (!Number.isFinite(seconds) || seconds < 60) throw new Error("--seconds must be at least 60");
  await mkdir(outputDirectory, { recursive: true });
  const captures = await runPackagedRetentionBenchmark({
    openScenario: (count) => openPackagedScenario(appPath, count),
    settleScenario: async (_count, scenario) => {
      const deadline = Date.now() + settlingMilliseconds;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        await scenario.keepAlive();
      }
    },
    captureScenario: (scenario) => runCapture({ ...scenario, outputDirectory, seconds }),
  });
  const report = renderReport(analyzeCaptureSet(captures));
  const reportPath = path.join(outputDirectory, "native-view-retention-report.md");
  await writeFile(reportPath, report);
  process.stdout.write(`${report}\nEvidence: ${outputDirectory}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
