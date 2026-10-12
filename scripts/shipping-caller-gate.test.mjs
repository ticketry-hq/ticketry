import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const gate = resolve(import.meta.dirname, "shipping-caller-gate.mjs");

function runGate(...args) {
  const result = spawnSync(process.execPath, [gate, ...args], { encoding: "utf8" });
  return { status: result.status, output: result.stdout + result.stderr };
}

test("the shipping checkout passes the caller gate", () => {
  const { status, output } = runGate();
  assert.equal(status, 0, output);
});

const shippingFiles = [
  ".github/workflows/ci.yml",
  "studio/release/manifest.v1.json",
  "studio/scripts/desktop-dev.mjs",
  "studio/scripts/desktop-smoke.mjs",
  "studio/scripts/release-build.mjs",
  "studio/src-tauri/tauri.conf.json",
  "scripts/web-dev.mjs",
];
const attachClient = "studio/src/features/agents/terminal/internal/browserTerminalClient.ts";
const attachProxy = `export const devProxy = {
  "/graphql": { target: origin },
  "/ws/terminal": {
    target: origin,
    ws: true,
  },
};
`;

// A minimal checkout whose browser runtime attaches over `/ws/terminal`.
function fixtureCheckout(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "caller-gate-"));
  const files = {
    "package.json": JSON.stringify({ scripts: { web: "node scripts/web-dev.mjs" } }),
    "studio/src-tauri/crates/app/ticketry-desktop/src/desktop/mcp_runtime.rs": "",
    ...Object.fromEntries(shippingFiles.map((file) => [file, ""])),
    "studio/src/main.tsx": 'import "./runtime/browserRuntime";\nimport "./features/agents/terminal/internal/browserTerminalClient";\n',
    "studio/src/runtime/browserRuntime.ts": 'const TERMINAL_WEBSOCKET_PATH = "/ws/terminal";\n',
    [attachClient]: "const ws = new WebSocket(terminalWebSocketUrl());\n",
    "studio/vite.proxy.ts": attachProxy,
    ...overrides,
  };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

test("the browser terminal attach socket passes", () => {
  const { status, output } = runGate("--root", fixtureCheckout());
  assert.equal(status, 0, output);
});

test("a reachable status socket fails", () => {
  const { status, output } = runGate(
    "--root",
    fixtureCheckout({ "studio/src/runtime/browserRuntime.ts": 'const STATUS = "/ws/status";\n' }),
  );
  assert.equal(status, 1);
  assert.match(output, /studio\/src\/runtime\/browserRuntime\.ts:1: retired status socket/);
});

// Only the exact `/ws/terminal` path is supported; a route that merely shares
// its prefix is another socket.
for (const path of ["/ws/terminal-status", "/ws/terminal/status", "/ws/terminals"]) {
  test(`a reachable ${path} socket fails`, () => {
    const { status, output } = runGate(
      "--root",
      fixtureCheckout({ "studio/src/runtime/browserRuntime.ts": `const PATH = "${path}";\n` }),
    );
    assert.equal(status, 1);
    assert.match(output, /studio\/src\/runtime\/browserRuntime\.ts:1: retired status socket/);
  });
}

test("a WebSocket opened outside the browser terminal client fails", () => {
  const { status, output } = runGate(
    "--root",
    fixtureCheckout({ "studio/src/runtime/browserRuntime.ts": 'const socket = new WebSocket("/ws/terminal");\n' }),
  );
  assert.equal(status, 1);
  assert.match(output, /browserRuntime\.ts:1: WebSocket outside the browser terminal client/);
});

for (const [name, route] of [
  ["a WebSocket upgrade on another route", '  "/graphql/subscribe": { target: origin, ws: true },\n'],
  ["a retired status socket route", '  "/ws/status": { target: origin },\n'],
  ["a REST route", '  "/api/work-tracker": { target: origin },\n'],
  ["a route sharing the terminal prefix", '  "/ws/terminal-status": { target: origin },\n'],
  ["a route nested under the terminal socket", '  "/ws/terminal/status": { target: origin },\n'],
]) {
  test(`a development proxy with ${name} fails`, () => {
    const proxy = attachProxy.replace('  "/graphql"', `${route}  "/graphql"`);
    const { status, output } = runGate("--root", fixtureCheckout({ "studio/vite.proxy.ts": proxy }));
    assert.equal(status, 1);
    assert.match(output, /studio\/vite\.proxy\.ts: development proxy exposes retired REST or WebSocket routing/);
  });
}
