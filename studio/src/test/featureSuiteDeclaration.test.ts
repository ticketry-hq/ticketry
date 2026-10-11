import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

it("declares feature tags with the default test and preserves extended fixtures", () => {
  const directory = mkdtempSync(join(tmpdir(), "ticketry-feature-declaration-"));
  directories.push(directory);
  const playwright = resolve(__dirname, "../../../node_modules/@playwright/test/index.mjs");
  const helper = resolve(__dirname, "../../e2e/features/featureSuite.ts");
  writeFileSync(join(directory, "playwright.config.ts"), `export default {testDir: '.', workers: 1, reporter: 'json', outputDir: ${JSON.stringify(join(directory, 'results'))}};`);
  writeFileSync(join(directory, "declaration.spec.ts"), `
    import {test, expect} from ${JSON.stringify(playwright)};
    import {featureSuite} from ${JSON.stringify(helper)};
    featureSuite('startup', () => {
      test('ready', {tag: '@case-startup-ready'}, () => {});
    });
    const health = test.extend({health: ['fixture reached', {option: true}]});
    featureSuite('planning', {test: health, isolation: 'case', profile: 'first-run'}, () => {
      health('healthy', {tag: '@case-planning-healthy'}, async ({health}) => {
        expect(health).toBe('fixture reached');
      });
    });
  `);
  const result = spawnSync(process.execPath, [resolve(__dirname, "../../../node_modules/@playwright/test/cli.js"), "test", "--config", join(directory, "playwright.config.ts")], {encoding: "utf8"});
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const report = JSON.parse(result.stdout);
  const cases = report.suites[0].suites.flatMap((suite: {specs: unknown[]}) => suite.specs);
  expect(cases).toEqual(expect.arrayContaining([
    expect.objectContaining({title: "ready", tags: ["feature-startup", "case-startup-ready"], ok: true}),
    expect.objectContaining({title: "healthy", tags: ["feature-planning", "case-planning-healthy"], ok: true}),
  ]));
});
