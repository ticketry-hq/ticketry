import assert from "node:assert/strict";
import test from "node:test";
import { parseGlobalLaunchDefault } from "./read-persisted-model-settings.mjs";

const storedDefault = {
  provider: "claude", profile: null, model: "opus", reasoning: "high",
};

test("reads the current persisted launch default including its profile", () => {
  assert.deepEqual(parseGlobalLaunchDefault(JSON.stringify({
    global_default: storedDefault,
  })), storedDefault);
});

test("refuses unknown default fields and malformed profiles", () => {
  for (const invalid of [
    { ...storedDefault, unsupported: true },
    { ...storedDefault, profile: 42 },
  ]) {
    assert.equal(parseGlobalLaunchDefault(JSON.stringify({
      global_default: invalid,
    })), null);
  }
});
