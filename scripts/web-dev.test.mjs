import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildWebFrontendCommand,
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
  assert.equal(launch.environment.MUXED_SKIP_LOCAL_STATE_MIGRATION, "1");
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
