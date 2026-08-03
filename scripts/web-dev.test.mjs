import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildWebFrontendCommand,
  buildWebMcpCommand,
  buildWebRuntimeEnvironment,
  buildWebDevelopmentEnvironment,
  selectWebPort,
} from "./web-dev.mjs";

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

test("web services share one backend and the pinned MCP endpoint", () => {
  const environment = buildWebRuntimeEnvironment({
    environment: { PRESERVED: "yes", WORKTRACKER_API_TOKEN: "development-token" },
    backendPort: 8788,
  });

  assert.equal(environment.PRESERVED, "yes");
  assert.equal(environment.MCP_HOST, "127.0.0.1");
  assert.equal(environment.MCP_PORT, "8123");
  assert.equal(environment.WORKTRACKER_API_KEY, "development-token");
  assert.equal(
    environment.WORKTRACKER_BASE_URL,
    "http://127.0.0.1:8788/api/work-tracker",
  );
  assert.equal(environment.WORKTRACKER_MCP_URL, "http://127.0.0.1:8123/mcp");
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
