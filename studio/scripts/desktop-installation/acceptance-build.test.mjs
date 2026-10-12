import assert from "node:assert/strict";
import test from "node:test";

import { buildDesktopAcceptanceApplication } from "./acceptance-build.mjs";

function recordBuild(environment) {
  const calls = [];
  const logs = [];
  buildDesktopAcceptanceApplication({
    environment,
    run: (command, args, options) => calls.push({ command, args, options }),
    log: (line) => logs.push(line),
  });
  return { calls, logs };
}

test("default Pocock desktop acceptance builds only the desktop-acceptance feature", () => {
  for (const environment of [{}, { TICKETRY_EDITION: "pocock" }]) {
    const { calls, logs } = recordBuild({ ...environment, PATH: "/usr/bin" });

    assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
      ["bun", "run", "libghostty:prepare"],
      ["bun", "run", "tauri", "build", "--debug", "--no-bundle", "--features", "desktop-acceptance"],
    ]);
    for (const { options } of calls) {
      assert.equal(options.env.TICKETRY_EDITION, "pocock");
      assert.equal(options.env.PATH, "/usr/bin");
    }
    assert.equal(JSON.stringify(calls).includes("edition-core"), false);
    assert.equal(logs.filter((line) => line.startsWith("Edition: ")).length, 1);
  }
});

test("core desktop acceptance merges edition-core with desktop-acceptance", () => {
  const { calls, logs } = recordBuild({ TICKETRY_EDITION: "core" });

  assert.deepEqual(calls[1].args, ["run", "tauri", "build", "--debug", "--no-bundle", "--features", "desktop-acceptance,edition-core"]);
  assert.equal(calls[1].options.env.TICKETRY_EDITION, "core");
  assert.deepEqual(logs, ["Edition: core (explicit)"]);
});

test("an invalid edition fails desktop acceptance before any build step", () => {
  assert.throws(() => recordBuild({ TICKETRY_EDITION: "full" }), /pocock.*core/);
  const calls = [];
  assert.throws(() => buildDesktopAcceptanceApplication({
    environment: { TICKETRY_EDITION: "Core", TICKETRY_DESKTOP_ACCEPTANCE_SKIP_BUILD: "1" },
    run: (...call) => calls.push(call),
    log: () => {},
  }), /pocock.*core/);
  assert.deepEqual(calls, []);
});

test("a skipped acceptance build runs nothing for a valid edition", () => {
  const { calls } = recordBuild({ TICKETRY_DESKTOP_ACCEPTANCE_SKIP_BUILD: "1" });
  assert.deepEqual(calls, []);
});
