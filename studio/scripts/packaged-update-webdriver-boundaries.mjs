import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { remote } from "webdriverio";

import { findAppExecutable } from "./installed-artifact-acceptance-driver.mjs";

const DEFAULT_TIMEOUT_MS = 90_000;
const OWNER_FILE = ".muxed-desktop-owner.json";

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

async function waitFor(check, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopPid(pid) {
  if (!processAlive(pid)) return;
  process.kill(pid, "SIGTERM");
  try {
    await waitFor(() => !processAlive(pid), `process ${pid} shutdown`, 5_000);
  } catch {
    if (processAlive(pid)) process.kill(pid, "SIGKILL");
  }
}

function spawnInstalledApp(executable, {
  cwd,
  environment,
  stderrPath,
  stdoutPath,
}) {
  const child = spawn(executable, [], {
    cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = createWriteStream(stdoutPath, { flags: "a" });
  const stderr = createWriteStream(stderrPath, { flags: "a" });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  return child;
}

async function connect(port) {
  const session = await remote({
    hostname: "127.0.0.1",
    port,
    logLevel: "warn",
    capabilities: {
      "wdio:tauriServiceOptions": { windowLabel: "main" },
    },
  });
  session.__ticketryExecuteWebviewRequest = (request) =>
    executeDirectWebviewRequest(port, request);
  return session;
}

function directEvalScript(request) {
  const serialized = JSON.stringify(request).replaceAll("<", "\\u003c");
  return `
    var done = arguments[arguments.length - 1];
    var request_ = ${serialized};
    var run = async function () {
      if (request_.kind === "storage-write") {
        for (var entry of Object.entries(request_.values)) {
          globalThis.localStorage.setItem(entry[0], entry[1]);
        }
        return { ok: true };
      }
      if (request_.kind === "storage-read") {
        return Object.fromEntries(request_.keys.map(function (key) {
          return [key, globalThis.localStorage.getItem(key)];
        }));
      }
      try {
        var value = await globalThis.__TAURI_INTERNALS__.invoke(
          request_.command,
          request_.args
        );
        return { ok: true, value: value };
      } catch (caught) {
        var error = caught;
        if (typeof error === "string") {
          try { error = JSON.parse(error); }
          catch (_) { error = { message: error }; }
        }
        return {
          ok: false,
          error: {
            code: error && error.code,
            message: error && error.message ? error.message : String(caught),
            retryable: error && error.retryable
          }
        };
      }
    };
    run().then(
      function (value) { done({ ok: true, value: value }); },
      function (error) { done({ ok: false, error: String(error) }); }
    );
  `;
}

export async function executeDirectWebviewRequest(
  port,
  request,
  requestHttp = fetch,
) {
  const response = await requestHttp(`http://127.0.0.1:${port}/wdio/eval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      script: directEvalScript(request),
      window_label: "main",
      timeout_ms: DEFAULT_TIMEOUT_MS,
    }),
  });
  const result = await response.json();
  if (!response.ok || result.error) {
    throw new Error(result.error ?? `direct WebDriver eval failed (${response.status})`);
  }
  return result.value;
}

async function readLockOwner(dataDirectory) {
  try {
    const value = JSON.parse(await readFile(path.join(dataDirectory, OWNER_FILE), "utf8"));
    return Number.isInteger(value?.pid) && value.pid > 0 ? value : null;
  } catch {
    return null;
  }
}

function sqliteDump(databasePath, pattern) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/sqlite3", [databasePath, `.dump ${pattern}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
      } else {
        reject(new Error(
          `sqlite evidence query failed (${code ?? signal}): ${Buffer.concat(stderr).toString("utf8").trim()}`,
        ));
      }
    });
  });
}

export const defaultPackagedUpdateWebDriverBoundaries = {
  allocatePort: availablePort,
  connect,
  findAppExecutable,
  isProcessAlive: processAlive,
  readLockOwner,
  spawnApp: spawnInstalledApp,
  sqliteDump,
  stopPid,
  waitFor,
};

export async function executeWebviewRequest(session, request) {
  if (typeof session.__ticketryExecuteWebviewRequest === "function") {
    return session.__ticketryExecuteWebviewRequest(request);
  }
  const executeRequest = async (request_) => {
    if (request_.kind === "storage-write") {
      for (const [key, value] of Object.entries(request_.values)) {
        globalThis.localStorage.setItem(key, value);
      }
      return { ok: true };
    }
    if (request_.kind === "storage-read") {
      return Object.fromEntries(
        request_.keys.map((key) => [key, globalThis.localStorage.getItem(key)]),
      );
    }
    try {
      const value = await globalThis.__TAURI_INTERNALS__.invoke(
        request_.command,
        request_.args,
      );
      return { ok: true, value };
    } catch (caught) {
      let error = caught;
      if (typeof error === "string") {
        try {
          error = JSON.parse(error);
        } catch {
          error = { message: error };
        }
      }
      return {
        ok: false,
        error: {
          code: error?.code,
          message: error?.message ?? String(caught),
          retryable: error?.retryable,
        },
      };
    }
  };
  if (typeof session.executeAsync !== "function") {
    return session.execute(executeRequest, request);
  }
  return session.executeAsync((request_, done) => {
    const run = async () => {
      if (request_.kind === "storage-write") {
        for (const [key, value] of Object.entries(request_.values)) {
          globalThis.localStorage.setItem(key, value);
        }
        return { ok: true };
      }
      if (request_.kind === "storage-read") {
        return Object.fromEntries(
          request_.keys.map((key) => [key, globalThis.localStorage.getItem(key)]),
        );
      }
      try {
        const value = await globalThis.__TAURI_INTERNALS__.invoke(
          request_.command,
          request_.args,
        );
        return { ok: true, value };
      } catch (caught) {
        let error = caught;
        if (typeof error === "string") {
          try {
            error = JSON.parse(error);
          } catch {
            error = { message: error };
          }
        }
        return {
          ok: false,
          error: {
            code: error?.code,
            message: error?.message ?? String(caught),
            retryable: error?.retryable,
          },
        };
      }
    };
    void run().then(done, (error) => done({
      ok: false,
      error: { message: error?.message ?? String(error) },
    }));
  }, request);
}

function actionFromMessage(message) {
  if (typeof message !== "string") return undefined;
  const sentences = message.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim()) ?? [];
  return sentences.length > 1 ? sentences.at(-1) : undefined;
}

export function packagedUpdateRuntimeError(value) {
  const error = value && typeof value === "object" ? value : {};
  const message = typeof error.message === "string" ? error.message : String(value);
  const action = actionFromMessage(message);
  return {
    ...(typeof error.code === "string" ? { code: error.code } : {}),
    message,
    ...(action ? { action } : {}),
    ...(typeof error.retryable === "boolean" ? { retryable: error.retryable } : {}),
  };
}
