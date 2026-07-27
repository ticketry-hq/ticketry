import assert from "node:assert/strict";
import test from "node:test";
import { ReleasePublicationError, publishRelease } from "./release-publish.mjs";

const manifest = { release_version: "0.1.0" };
const targets = [{ id: "macos-aarch64" }, { id: "macos-x86_64" }];

test("publication runs installed-artifact acceptance for every supported target first", async () => {
  const calls = [];
  await publishRelease({
    manifest,
    targets,
    driverPath: "/opt/acceptance-driver",
    publishCommand: ["/opt/publisher", "upload"],
    accept: async ({ bundlePath, driverPath }) => calls.push(["accept", bundlePath, driverPath]),
    execute: async (command, args) => calls.push(["publish", command, ...args]),
  });
  assert.equal(calls.filter(([kind]) => kind === "accept").length, 2);
  assert.deepEqual(calls.at(-1), ["publish", "/opt/publisher", "upload"]);
});

test("publication fails closed when acceptance fails", async () => {
  const calls = [];
  await assert.rejects(
    publishRelease({
      manifest,
      targets: [targets[0]],
      driverPath: "/opt/acceptance-driver",
      publishCommand: ["/opt/publisher", "upload"],
      accept: async () => { throw new Error("durable flow failed"); },
      execute: async () => calls.push("published"),
    }),
    /durable flow failed/,
  );
  assert.deepEqual(calls, []);
});

test("publication cannot run without an explicit publisher", async () => {
  await assert.rejects(
    publishRelease({ manifest, targets: [], driverPath: "/driver", publishCommand: [] }),
    ReleasePublicationError,
  );
});
