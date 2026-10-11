import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectFrontendPort } from "./invocation.mjs";

test("frontend port selection rejects malformed and occupied ports", async () => {
  for (const port of ["0", "65536", "abc", "1.5", ""]) await assert.rejects(selectFrontendPort(port), /port between/);
  const port = await selectFrontendPort();
  assert.ok(Number(port) > 0);
  const server = net.createServer();
  await new Promise((resolve) => server.listen(Number(port), "127.0.0.1", resolve));
  try { await assert.rejects(selectFrontendPort(port), { code: "EADDRINUSE" }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
});

test("each invocation owns all e2e environment values and a free adapter port", async () => {
  const { invocationEnvironment } = await import("./invocation.mjs");
  const parent = { PATH: "/bin", TICKETRY_E2E_DATA_DIR: "/live", TICKETRY_E2E_ADAPTER_PORT: "invalid", TICKETRY_E2E_UNKNOWN: "unsafe" };
  const { env, owned } = await invocationEnvironment({ dataDirectory: "/fresh", providerDirectory: "/fixture" }, "/evidence", "1234", parent);
  assert.equal(env.PATH, "/bin");
  assert.equal(env.TICKETRY_E2E_UNKNOWN, undefined);
  assert.equal(env.TICKETRY_E2E_DATA_DIR, "/fresh");
  assert.equal(env.TICKETRY_E2E_PROVIDER_DIR, "/fixture");
  assert.equal(env.TICKETRY_E2E_ARTIFACT_DIR, "/evidence");
  assert.equal(env.TICKETRY_E2E_FRONTEND_PORT, "1234");
  assert.ok(Number(env.TICKETRY_E2E_ADAPTER_PORT) > 0);
  assert.deepEqual(owned, Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("TICKETRY_E2E_"))));
  assert.equal(parent.TICKETRY_E2E_DATA_DIR, "/live");
});


test("invocation returns only after both evidence logs are flushed", async () => {
  const { runInvocation } = await import("./invocation.mjs");
  const directory = mkdtempSync(join(tmpdir(), "feature-invocation-"));
  const lifecycle = [];
  try {
    const result = await runInvocation([process.execPath, "-e", 'process.stdout.write("evidence".repeat(10000)); process.stderr.write("problem"); process.exitCode = 3'], process.env, directory, (child) => lifecycle.push(child));
    assert.equal(result.exitCode, 3);
    assert.equal(readFileSync(join(directory, "stdout.log"), "utf8"), "evidence".repeat(10000));
    assert.match(readFileSync(join(directory, "stderr.log"), "utf8"), /problem/);
    assert.ok(lifecycle[0].pid);
    assert.equal(lifecycle.at(-1), null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const signal of ["SIGINT", "SIGTERM"]) test(`termination ${signal} signals the entire invocation process group`, { skip: process.platform === "win32", timeout: 5000 }, async () => {
  const { runInvocation, stopProcessGroup } = await import("./invocation.mjs");
  const directory = mkdtempSync(join(tmpdir(), "feature-process-group-"));
  let active;
  try {
    const running = runInvocation([process.execPath, "-e", 'require("node:child_process").spawn(process.execPath,["-e", "setInterval(()=>{},1000)"],{stdio:"inherit"}); console.log("ready"); setInterval(()=>{},1000)'], process.env, directory, (child) => { active = child; });
    await new Promise((resolve) => active.stdout.once("data", resolve));
    stopProcessGroup(active, signal);
    const result = await running;
    assert.equal(result.signal, signal);
    assert.equal(active, null);
  } finally {
    if (active) stopProcessGroup(active, "SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("spawn failure still closes logs and clears the active child", async () => {
  const { runInvocation } = await import("./invocation.mjs");
  const directory = mkdtempSync(join(tmpdir(), "feature-spawn-error-"));
  let active;
  try {
    await assert.rejects(runInvocation([join(directory, "missing-command")], process.env, directory, (child) => { active = child; }), { code: "ENOENT" });
    assert.equal(active, null);
    assert.equal(readFileSync(join(directory, "stdout.log"), "utf8"), "");
    assert.equal(readFileSync(join(directory, "stderr.log"), "utf8"), "");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
