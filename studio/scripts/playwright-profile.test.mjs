import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("Playwright shares one isolated socket profile and removes it on runner exit", () => {
  const result = spawnSync(process.execPath, ["-e", `
    const ts = require('typescript');
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    function load(file) {
      const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText;
      const module = { exports: {} };
      new Function('require', 'module', 'exports', output)(require, module, module.exports);
      return module.exports.default;
    }
    delete process.env.TICKETRY_E2E_DATA_DIR;
    const config = load('studio/playwright.config.ts');
    const directory = process.env.TICKETRY_E2E_DATA_DIR;
    assert(fs.existsSync(directory));
    assert.equal(config.webServer.env.MUXED_DATA_DIR, directory);
    assert.equal(config.webServer.env.MUXED_FORCE_SQLITE, 'true');
    assert(!config.webServer.command.includes('--temp-sqlite'));
    assert.equal(load('studio/playwright.config.ts').webServer.env.MUXED_DATA_DIR, directory);
    const externalDirectory = fs.mkdtempSync('/tmp/ticketry-e2e-explicit-');
    process.env.TICKETRY_E2E_DATA_DIR = require('node:path').relative(process.cwd(), externalDirectory);
    assert.equal(load('studio/playwright.config.ts').webServer.env.MUXED_DATA_DIR, externalDirectory);
    assert.equal(process.env.TICKETRY_E2E_DATA_DIR, externalDirectory);
    console.log(JSON.stringify({ directory, externalDirectory }));
  `], { cwd: fileURLToPath(new URL("../..", import.meta.url)), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const { directory, externalDirectory } = JSON.parse(result.stdout);
  try {
    assert(directory.includes("ticketry-e2e-"));
    assert(!existsSync(directory), "profile must be removed after runner exit");
    assert(existsSync(externalDirectory), "explicit profile must not be removed");
  } finally {
    rmSync(externalDirectory, { recursive: true, force: true });
  }
});
