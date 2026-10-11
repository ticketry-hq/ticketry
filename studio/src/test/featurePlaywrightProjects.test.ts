import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error Shared Node module is used directly by Playwright.
import { featurePlaywrightProjects } from "../../scripts/feature-e2e/playwright-projects.mjs";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

it("routes only declared first-run features away from onboarding setup", () => {
  const directory = mkdtempSync(join(tmpdir(), "ticketry-projects-"));
  directories.push(directory);
  mkdirSync(join(directory, "features"));
  for (const [file, source] of Object.entries({
    "onboarding": `featureSuite('onboarding', { profile: 'first-run' }, () => {});`,
    "stories": `featureSuite('stories', () => {});`,
    "settings": `featureSuite('settings', { profile: 'onboarded' }, () => {});`,
  })) writeFileSync(join(directory, "features", `${file}.spec.ts`), source);
  const [setup, chromium, firstRun] = featurePlaywrightProjects(directory, {browserName: "chromium"});
  expect(setup).toMatchObject({name: "setup", testMatch: /.*\.setup\.ts/});
  expect(chromium.dependencies).toEqual(["setup"]);
  expect(firstRun.name).toBe("first-run");
  expect(firstRun.dependencies).toBeUndefined();
  for (const file of ["features/onboarding.spec.ts", "features/stories.spec.ts", "features/settings.spec.ts", "web-app.spec.ts", "onboarding.setup.ts"]) {
    const first = file === "features/onboarding.spec.ts";
    const path = join(directory, file);
    expect(firstRun.testMatch.test(path)).toBe(first);
    expect(chromium.testIgnore.some((pattern: RegExp) => pattern.test(path))).toBe(first || file.endsWith(".setup.ts"));
  }
});

it("keeps existing specs in Chromium when no first-run suites exist", () => {
  const directory = mkdtempSync(join(tmpdir(), "ticketry-empty-projects-"));
  directories.push(directory);
  const [, chromium, firstRun] = featurePlaywrightProjects(directory, {});
  expect(firstRun.testMatch.test(join(directory, "existing.spec.ts"))).toBe(false);
  expect(chromium.testIgnore.some((pattern: RegExp) => pattern.test(join(directory, "existing.spec.ts")))).toBe(false);
});

it("Playwright discovers each profile only in its declared project", () => {
  const directory = mkdtempSync(join(tmpdir(), "ticketry-profile-discovery-"));
  directories.push(directory);
  mkdirSync(join(directory, "features"));
  const helper = resolve(__dirname, "../../e2e/features/featureSuite.ts");
  const playwright = resolve(__dirname, "../../../node_modules/@playwright/test/index.mjs");
  for (const [id, profile] of [["onboarding", "first-run"], ["stories", "onboarded"]]) {
    writeFileSync(join(directory, "features", `${id}.spec.ts`), `
      import {test} from ${JSON.stringify(playwright)};
      import {featureSuite} from ${JSON.stringify(helper)};
      featureSuite('${id}', {profile: '${profile}'}, () => {test('${id} case', () => {});});
    `);
  }
  writeFileSync(join(directory, "old.spec.ts"), `import {test} from ${JSON.stringify(playwright)}; test('legacy case', () => {});`);
  writeFileSync(join(directory, "onboarding.setup.ts"), `import {test} from ${JSON.stringify(playwright)}; test('setup case', () => {});`);
  const projectsModule = resolve(__dirname, "../../scripts/feature-e2e/playwright-projects.mjs");
  const config = join(directory, "playwright.config.mjs");
  writeFileSync(config, `import {featurePlaywrightProjects} from ${JSON.stringify(projectsModule)};
    export default {testDir: ${JSON.stringify(directory)}, projects: featurePlaywrightProjects(${JSON.stringify(directory)}, {})};`);
  const result = spawnSync(process.execPath, [resolve(__dirname, "../../../node_modules/@playwright/test/cli.js"), "test", "--list", "--config", config], {encoding: "utf8", cwd: directory});
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toMatch(/\[first-run\].*features\/onboarding\.spec\.ts/);
  expect(result.stdout).toMatch(/\[chromium\].*features\/stories\.spec\.ts/);
  expect(result.stdout).toMatch(/\[chromium\].*old\.spec\.ts/);
  expect(result.stdout).not.toMatch(/\[chromium\].*features\/onboarding\.spec\.ts/);
  expect(result.stdout).not.toMatch(/\[first-run\].*features\/stories\.spec\.ts/);
  expect(result.stdout).toContain("Total: 4 tests in 4 files");
});
