import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { remote } from "webdriverio";

/**
 * Launching and connecting to a test-only desktop Ticketry over WebDriver.
 *
 * Extracted from the agent acceptance driver so more than one harness can
 * start the real macOS WKWebView build without rerunning that scenario. It
 * owns process lifetime and the WebDriver session only; what the session is
 * then used for belongs to the caller.
 *
 * The embedded WebDriver exists solely under the Rust `desktop-acceptance`
 * feature and is absent from production builds.
 */
const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(studioRoot, "..");

export function defaultDesktopBinary({ environment = process.env } = {}) {
  return environment.TICKETRY_DESKTOP_ACCEPTANCE_BINARY
    ?? path.join(studioRoot, "src-tauri", "target", "debug", "ticketry");
}

export async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

export async function waitForPort(port, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Ticketry exited before WebDriver started (${child.exitCode})`);
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
  throw new Error(`WebDriver did not listen on port ${port}`);
}

export async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  const killed = once(child, "exit");
  child.kill("SIGKILL");
  await killed;
}

export function spawnTicketry(binary, environment, stdout, stderr) {
  const childEnvironment = { ...process.env, ...environment };
  const child = spawn(binary, [], {
    cwd: repositoryRoot,
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  return child;
}

export async function connectToStudio(port, child) {
  await waitForPort(port, child);
  const browser = await remote({
    hostname: "127.0.0.1",
    port,
    logLevel: "warn",
    capabilities: {
      "wdio:tauriServiceOptions": { windowLabel: "main" },
    },
  });
  if (await browser.getUrl() === "about:blank") {
    await browser.url("tauri://localhost/");
  }
  await browser.waitUntil(async () =>
    await browser.execute(() => document.readyState === "complete"), {
    timeout: 20_000,
    timeoutMsg: "the embedded Studio document did not finish loading",
  });
  await browser.execute(() => {
    const messages = [];
    window.__ticketryAcceptanceDiagnostics = messages;
    window.addEventListener("error", (event) => {
      messages.push({ type: "error", message: event.message });
    });
    window.addEventListener("unhandledrejection", (event) => {
      messages.push({ type: "unhandledrejection", message: String(event.reason) });
    });
    const original = console.error.bind(console);
    console.error = (...values) => {
      messages.push({ type: "console.error", message: values.map(String).join(" ") });
      original(...values);
    };
  });
  return browser;
}
