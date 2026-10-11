import assert from "node:assert/strict";
import test from "node:test";
import { parseGlobalLaunchDefault } from "./read-persisted-model-settings.mjs";

test("reads a default that carries the Codex profile key the Rust reader accepts", () => {
  const stored = JSON.stringify({
    global_default: { provider: "claude", profile: null, model: "opus", reasoning: "high" },
  });
  assert.deepEqual(parseGlobalLaunchDefault(stored), {
    provider: "claude",
    profile: null,
    model: "opus",
    reasoning: "high",
  });
});

test("keeps a named Codex profile and treats a blank field as unset", () => {
  const stored = JSON.stringify({
    global_default: { provider: " codex ", profile: "work", model: " ", reasoning: null },
  });
  assert.deepEqual(parseGlobalLaunchDefault(stored), {
    provider: "codex",
    profile: "work",
    model: null,
    reasoning: null,
  });
});

test("salvages an unknown key or a non-string field to no default", () => {
  for (const globalDefault of [
    { provider: "codex", model: "gpt-5.4", sandbox: "none" },
    { provider: "codex", profile: 1 },
    { provider: "  " },
  ]) {
    assert.equal(parseGlobalLaunchDefault(JSON.stringify({ global_default: globalDefault })), null);
  }
});
