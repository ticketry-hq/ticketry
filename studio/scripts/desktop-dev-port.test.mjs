import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTauriDevelopmentConfig,
  selectFrontendPort,
} from "./desktop-dev.mjs";

test("uses the default frontend port and coordinates strict Vite with Tauri", async () => {
  const port = await selectFrontendPort({ isAvailable: async () => true });
  assert.equal(port, 5174);
  assert.deepEqual(buildTauriDevelopmentConfig(port), {
    build: {
      beforeDevCommand: "npm run dev -- --host 127.0.0.1 --port 5174 --strictPort",
      devUrl: "http://127.0.0.1:5174",
    },
  });
});

test("selects the next bounded candidate when the default is occupied", async () => {
  const attempted = [];
  const port = await selectFrontendPort({
    isAvailable: async (candidate) => {
      attempted.push(candidate);
      return candidate === 5176;
    },
  });
  assert.equal(port, 5176);
  assert.deepEqual(attempted, [5174, 5175, 5176]);
});

test("fails actionably after exhausting bounded candidates", async () => {
  let attempts = 0;
  await assert.rejects(
    selectFrontendPort({ isAvailable: async () => { attempts += 1; return false; } }),
    /No frontend port is available in 5174-5183/,
  );
  assert.equal(attempts, 10);
});

test("does not shift an unavailable explicit frontend port", async () => {
  const attempted = [];
  await assert.rejects(
    selectFrontendPort({
      requestedPort: "6200",
      isAvailable: async (candidate) => { attempted.push(candidate); return false; },
    }),
    /Requested frontend port 6200 is unavailable/,
  );
  assert.deepEqual(attempted, [6200]);
});

test("rejects an invalid explicit frontend port", async () => {
  await assert.rejects(
    selectFrontendPort({ requestedPort: "not-a-port" }),
    /MUXED_FRONTEND_PORT must be a valid TCP port/,
  );
});
