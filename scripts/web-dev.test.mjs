import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createDevelopmentLogCapture } from "./dev-log-capture.mjs";
import {
  buildWebFrontendCommand,
  buildWebMcpCommand,
  buildWebRuntimeEnvironment,
  buildWebDevelopmentEnvironment,
  cleanupTemporaryWebLaunch,
  parseWebDevOptions,
  readProvisionedApiToken,
  selectTemporaryMcpPort,
  selectWebMcpPort,
  selectWebPort,
} from "./web-dev.mjs";
import { removeTemporarySqliteProfile } from "../studio/scripts/desktop-dev.mjs";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));

test("web development preserves terminal output and persists labeled service logs", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ticketry-web-logs-"));
  const logPath = path.join(directory, "ticketry.log");
  const terminal = { stdout: [], stderr: [] };
  const capture = createDevelopmentLogCapture({
    logPath,
    stdout: { write: (chunk) => terminal.stdout.push(String(chunk)) },
    stderr: { write: (chunk) => terminal.stderr.push(String(chunk)) },
    now: () => new Date("2026-08-10T00:00:00.000Z"),
  });

  capture.write("backend", "stdout", "ready\npartial");
  capture.write("backend", "stdout", " response\n");
  capture.write("MCP", "stderr", "fatal error\n");
  capture.close();

  assert.deepEqual(terminal, {
    stdout: ["ready\npartial", " response\n"],
    stderr: ["fatal error\n"],
  });
  assert.equal(
    readFileSync(logPath, "utf8"),
    [
      "2026-08-10T00:00:00.000Z [backend:stdout] ready",
      "2026-08-10T00:00:00.000Z [backend:stdout] partial response",
      "2026-08-10T00:00:00.000Z [MCP:stderr] fatal error",
      "",
    ].join("\n"),
  );
  rmSync(directory, { recursive: true });
});

test("web development logs rotate through the shared retained generations", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ticketry-web-logs-"));
  const logPath = path.join(directory, "ticketry.log");
  const discard = { write() {} };
  const capture = createDevelopmentLogCapture({
    logPath,
    stdout: discard,
    stderr: discard,
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    limitBytes: 80,
  });

  capture.write("backend", "stderr", "first failure\n");
  capture.write("backend", "stderr", "second failure\n");
  capture.write("backend", "stderr", "third failure\n");
  capture.close();

  assert.equal(existsSync(`${logPath}.1`), true);
  assert.match(readFileSync(`${logPath}.1`, "utf8"), /second failure/);
  assert.match(readFileSync(logPath, "utf8"), /third failure/);
  rmSync(directory, { recursive: true });
});

test("web development uses an isolated explicit data directory", () => {
  const launch = buildWebDevelopmentEnvironment({
    cwd: "/repository",
    environment: {
      MUXED_DATA_DIR: "../ticketry-web-data",
      PRESERVED: "yes",
    },
  });

  assert.equal(launch.dataDirectory, "/ticketry-web-data");
  assert.equal(launch.environment.PRESERVED, "yes");
  assert.equal(launch.environment.MUXED_DATA_DIR, "/ticketry-web-data");
  assert.equal(
    launch.environment.MUXED_STATE_DB,
    path.join("/ticketry-web-data", "state.db"),
  );
  assert.equal(launch.environment.WORKTRACKER_DISABLE_AUTH, "true");
  assert.match(
    launch.environment.MUXED_TMUX_SOCKET,
    /^muxed-dev-[0-9a-f]{16}$/,
  );
});

test("web development accepts a disposable SQLite launch flag", () => {
  assert.deepEqual(parseWebDevOptions([]), { temporarySqlite: false });
  assert.deepEqual(parseWebDevOptions(["--temp-sqlite"]), {
    temporarySqlite: true,
  });
  assert.deepEqual(parseWebDevOptions(["--", "--temp-sqlite"]), {
    temporarySqlite: true,
  });
  assert.throws(
    () => parseWebDevOptions(["--unknown"]),
    /usage: npm run web -- \[--temp-sqlite\]/,
  );
});

test("temporary web development forces a fresh isolated SQLite profile", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ticketry-web-test-"));
  const launch = buildWebDevelopmentEnvironment({
    cwd: "/repository",
    environment: {
      MUXED_DATABASE_URL: "postgresql:///ticketry",
      MUXED_ENABLE_LOCAL_POSTGRES: "true",
    },
    temporarySqlite: true,
    temporaryRoot,
  });

  assert.equal(launch.temporarySqlite, true);
  assert.equal(existsSync(launch.dataDirectory), true);
  assert.equal(launch.environment.MUXED_FORCE_SQLITE, "true");
  assert.equal(
    launch.environment.MUXED_STATE_DB,
    path.join(launch.dataDirectory, "state.db"),
  );
  assert.match(launch.environment.MUXED_TMUX_SOCKET, /^muxed-dev-[0-9a-f]{16}$/);

  removeTemporarySqliteProfile(launch.dataDirectory, { temporaryRoot });
  rmSync(temporaryRoot, { recursive: true });
});

test("temporary web shutdown stops its tmux server before removing its profile", () => {
  const calls = [];
  cleanupTemporaryWebLaunch(
    {
      dataDirectory: "/tmp/ticketry-temp-sqlite-example",
      environment: { MUXED_TMUX_SOCKET: "muxed-dev-temporary" },
    },
    {
      stopTmux(socket) {
        calls.push(["stop-tmux", socket]);
      },
      removeProfile(dataDirectory) {
        calls.push(["remove-profile", dataDirectory]);
      },
      log(message) {
        calls.push(["log", message]);
      },
    },
  );

  assert.deepEqual(calls, [
    ["stop-tmux", "muxed-dev-temporary"],
    ["remove-profile", "/tmp/ticketry-temp-sqlite-example"],
    ["log", "[web] Removed temporary SQLite profile: /tmp/ticketry-temp-sqlite-example"],
  ]);
});

test("an explicit authentication choice is preserved", () => {
  const launch = buildWebDevelopmentEnvironment({
    cwd: "/repository",
    environment: {
      MUXED_DATA_DIR: "/tmp/ticketry-authenticated-web",
      WORKTRACKER_DISABLE_AUTH: "false",
    },
  });

  assert.equal(launch.environment.WORKTRACKER_DISABLE_AUTH, "false");
});

test("the frontend opens the ready page in the default browser", () => {
  const command = buildWebFrontendCommand(5191);

  assert.match(command, /(?:^|\s)--open(?:\s|$)/);
  assert.match(command, /--strictPort/);
  assert.match(command, /--port 5191/);
});

test("web development launches the owned WorkTracker MCP package", () => {
  assert.equal(
    buildWebMcpCommand(),
    "uv run --project surfaces/worktracker-agent python -m worktracker_agent.mcp.main",
  );
});

test("web development serves the backend through its ASGI application", () => {
  const devScript = readFileSync(path.join(scriptsDirectory, "dev.sh"), "utf8");

  assert.match(
    devScript,
    /uv run uvicorn studio_server\.asgi:application[^\n]*--reload/,
  );
  assert.doesNotMatch(devScript, /manage\.py runserver/);
});

test("web services share one backend and the pinned MCP endpoint", () => {
  const environment = buildWebRuntimeEnvironment({
    environment: { PRESERVED: "yes", WORKTRACKER_API_TOKEN: "development-token" },
    backendPort: 8788,
  });

  assert.equal(environment.PRESERVED, "yes");
  assert.equal(environment.MCP_HOST, "127.0.0.1");
  assert.equal(environment.MCP_PORT, "8123");
  assert.equal(environment.WORKTRACKER_API_KEY, "development-token");
  assert.equal(environment.WORKTRACKER_API_TOKEN, "development-token");
  assert.equal(environment.VITE_WT_API_KEY, "development-token");
  assert.equal(
    environment.WORKTRACKER_BASE_URL,
    "http://127.0.0.1:8788/api/work-tracker",
  );
  assert.equal(environment.WORKTRACKER_MCP_URL, "http://127.0.0.1:8123/mcp");
});

test("web development does not pass conflicting color settings to Node", () => {
  const environment = buildWebRuntimeEnvironment({
    environment: { FORCE_COLOR: "1", NO_COLOR: "1" },
    backendPort: 8788,
  });

  assert.equal(environment.FORCE_COLOR, "1");
  assert.equal(environment.NO_COLOR, undefined);
});

test("web development reuses the token written during provisioning", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ticketry-web-token-"));
  const tokenPath = path.join(directory, "worktracker_token");
  writeFileSync(tokenPath, "provisioned-token\n");

  assert.equal(
    readProvisionedApiToken({ dataDirectory: directory, environment: {} }),
    "provisioned-token",
  );
  assert.equal(
    readProvisionedApiToken({
      dataDirectory: directory,
      environment: { WORKTRACKER_API_TOKEN: "configured-token" },
    }),
    "configured-token",
  );

  rmSync(directory, { recursive: true });
});

test("temporary web MCP tries 8123 once and skips when it is occupied", async () => {
  const checked = [];
  const selected = await selectTemporaryMcpPort({
    isAvailable: async (port) => {
      checked.push(port);
      return false;
    },
  });

  assert.equal(selected, null);
  assert.deepEqual(checked, [8123]);
});

test("persistent web development selects the next free MCP port", async () => {
  const checked = [];
  const selected = await selectWebMcpPort({
    environment: {},
    isAvailable: async (port) => {
      checked.push(port);
      return port !== 8123;
    },
  });

  assert.equal(selected, 8124);
  assert.deepEqual(checked, [8123, 8124]);
});

test("a skipped temporary MCP removes inherited MCP configuration", () => {
  const environment = buildWebRuntimeEnvironment({
    environment: {
      MCP_HOST: "stale-host",
      MCP_PORT: "9999",
      MCP_TRANSPORT: "http",
      WORKTRACKER_MCP_URL: "http://stale.invalid/mcp",
    },
    backendPort: 8787,
    mcpPort: null,
  });

  assert.equal(environment.MCP_HOST, undefined);
  assert.equal(environment.MCP_PORT, undefined);
  assert.equal(environment.MCP_TRANSPORT, undefined);
  assert.equal(environment.WORKTRACKER_MCP_URL, undefined);
});

test("web services select the next free ports", async () => {
  const occupied = new Set([5174, 5175, 8787]);
  const isAvailable = async (port) => !occupied.has(port);

  assert.equal(
    await selectWebPort({
      name: "frontend port",
      firstPort: 5174,
      isAvailable,
    }),
    5176,
  );
  assert.equal(
    await selectWebPort({
      name: "backend port",
      firstPort: 8787,
      isAvailable,
    }),
    8788,
  );
});

test("an unavailable explicit web port fails instead of silently shifting", async () => {
  await assert.rejects(
    selectWebPort({
      name: "backend port",
      requestedPort: "43210",
      firstPort: 8787,
      isAvailable: async () => false,
    }),
    /Requested backend port 43210 is unavailable/,
  );
});
