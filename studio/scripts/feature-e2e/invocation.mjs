import net from "node:net";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export async function selectFrontendPort(requested) {
  if (requested !== undefined && (!/^\d+$/.test(String(requested)) || Number(requested) < 1 || Number(requested) > 65535)) {
    throw new Error("Requested frontend port must be a port between 1 and 65535");
  }
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: requested === undefined ? 0 : Number(requested), exclusive: true }, () => {
      const port = String(server.address().port);
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

/** Inherited E2E switches never get authority over a runner-owned profile. */
export async function invocationEnvironment(profile, artifactDirectory, frontendPort, parent = process.env) {
  const env = Object.fromEntries(Object.entries(parent).filter(([key]) => !key.startsWith("TICKETRY_E2E_")));
  let adapterPort;
  do { adapterPort = await selectFrontendPort(); } while (adapterPort === String(frontendPort));
  const owned = {
    TICKETRY_E2E_FRONTEND_PORT: String(frontendPort),
    TICKETRY_E2E_ADAPTER_PORT: adapterPort,
    TICKETRY_E2E_DATA_DIR: profile.dataDirectory,
    TICKETRY_E2E_PROVIDER_DIR: profile.providerDirectory,
    TICKETRY_E2E_ARTIFACT_DIR: artifactDirectory,
  };
  return { env: { ...env, ...owned }, owned };
}


/** Resolve after process closure and evidence flush, including spawn failures. */
export async function runInvocation(command, env, directory, onChild = () => {}) {
  const stdout = createWriteStream(join(directory, "stdout.log"));
  const stderr = createWriteStream(join(directory, "stderr.log"));
  const flush = Promise.all([finished(stdout), finished(stderr)]);
  // Attach rejection handling immediately: disk failures may precede spawn closure.
  flush.catch(() => {});
  const child = spawn(command[0], command.slice(1), {
    cwd: repositoryRoot, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
  });
  let spawnError;
  child.once("error", (error) => { spawnError = error; });
  const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ exitCode: code ?? 1, signal })));
  onChild(child);
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  child.stdout.on("data", (data) => process.stdout.write(data));
  child.stderr.on("data", (data) => process.stderr.write(data));
  try {
    const result = await closed;
    await flush;
    if (spawnError) throw spawnError;
    return result;
  } finally { onChild(null); }
}

/** Detached children share a group, so cancellation reaches their descendants. */
export function stopProcessGroup(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  try { process.kill(process.platform === "win32" ? child.pid : -child.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}
