import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareDesktopHookRunner } from "./desktop-hook-runner.mjs";

test("desktop development builds and stages the host Cargo hook before Tauri", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ticketry-hook-build-"));
  const target = "aarch64-apple-darwin";
  const calls = [];
  try {
    const output = prepareDesktopHookRunner({
      root,
      execute(command, args) {
        calls.push([command, args]);
        if (command === "rustc") return `host: ${target}\n`;
        const binary = path.join(root, "studio/src-tauri/target", target, "debug/ticketry-hook");
        mkdirSync(path.dirname(binary), { recursive: true });
        writeFileSync(binary, "cargo hook");
      },
    });
    assert.equal(output, path.join(root, `studio/src-tauri/binaries/ticketry-hook-${target}`));
    assert.equal(readFileSync(output, "utf8"), "cargo hook");
    assert.deepEqual(calls[1], ["cargo", [
      "build", "--locked", "--manifest-path", path.join(root, "studio/src-tauri/Cargo.toml"),
      "-p", "ticketry-hook", "--bin", "ticketry-hook", "--target", target,
      "--target-dir", path.join(root, "studio/src-tauri/target"),
    ]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
