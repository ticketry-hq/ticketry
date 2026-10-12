import assert from "node:assert/strict";
import test from "node:test";

import { planDesktopSmoke } from "./desktop-smoke.mjs";

const tauriCli = "/cli/tauri.js";

test("default Pocock smoke builds pass no edition feature and carry pocock to Vite", () => {
  for (const environment of [{}, { TICKETRY_EDITION: "pocock" }]) {
    const plan = planDesktopSmoke({ mode: "all", environment: { ...environment, PATH: "/usr/bin" }, tauriCli });

    assert.deepEqual(plan.packagedArguments, [tauriCli, "build", "--no-bundle"]);
    assert.deepEqual(plan.developmentArguments.slice(0, 3), [tauriCli, "dev", "--no-watch"]);
    assert.equal(plan.developmentArguments[3], "--config");
    assert.equal(JSON.stringify(plan).includes("edition-core"), false);
    assert.equal(plan.environment.TICKETRY_EDITION, "pocock");
    assert.equal(plan.environment.PATH, "/usr/bin");
    assert.equal(plan.environment.MUXED_DESKTOP_SMOKE_EXIT_AFTER_STARTUP, "1");
  }
});

test("core smoke builds pass edition-core to tauri dev and tauri build", () => {
  const plan = planDesktopSmoke({ mode: "all", environment: { TICKETRY_EDITION: "core" }, tauriCli });

  assert.deepEqual(plan.packagedArguments, [tauriCli, "build", "--no-bundle", "--features", "edition-core"]);
  assert.deepEqual(plan.developmentArguments.slice(0, 5), [tauriCli, "dev", "--no-watch", "--features", "edition-core"]);
  assert.equal(plan.environment.TICKETRY_EDITION, "core");
  assert.equal(plan.editionBuild.description, "Edition: core (explicit)");
});

test("the smoke development frontend listens on the requested smoke port", () => {
  const plan = planDesktopSmoke({ mode: "dev", environment: { MUXED_DESKTOP_SMOKE_PORT: "16000" }, tauriCli });
  const config = JSON.parse(plan.developmentArguments.at(-1));

  assert.equal(config.build.devUrl, "http://127.0.0.1:16000");
  assert.match(config.build.beforeDevCommand, /--port 16000 --strictPort/);
});

test("an invalid edition or mode fails the smoke plan before anything runs", () => {
  assert.throws(
    () => planDesktopSmoke({ mode: "all", environment: { TICKETRY_EDITION: "full" }, tauriCli }),
    /pocock.*core/,
  );
  assert.throws(
    () => planDesktopSmoke({ mode: "release", environment: {}, tauriCli }),
    /all, dev, or packaged/,
  );
});
