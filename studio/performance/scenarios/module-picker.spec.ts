import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";

import { recordCpuProfile } from "../collectors/chromium-cpu";
import {
  domNodeCount,
  expect,
  openSeededModule,
  openWorkspace,
  measuredRepetition,
  performanceTest as test,
  probeCapabilities,
  probeTotals,
  settle,
  startProbes,
  stopProbes,
  STEP_TIMEOUT_MS,
  windowErrors,
} from "../fixtures/scenario";
import { scenarioArtifactDirectory } from "../fixtures/run-context";

/**
 * Module picker.
 *
 * Open the picker, type a search that is known to match exactly one hidden
 * module, assert the filtered row, clear and close. Every repetition asserts
 * the state it waited for, so a timing is never the duration of a wait that
 * silently gave up.
 */
const WARMUPS = 3;
const REPETITIONS = 20;
const SETTLE_MS = 2_000;

test.use({ scenarioName: "module-picker" });

async function pickerCycle(page: Page, search: string, expectedModule: string) {
  const timeout = STEP_TIMEOUT_MS;
  const trigger = page.getByRole("button", { name: "Open module picker" });
  await trigger.click({ timeout });
  const picker = page.getByRole("dialog", { name: "Module picker" });
  const field = picker.getByRole("combobox", { name: "Search modules" });
  await expect(field).toBeFocused({ timeout });
  await field.fill(search, { timeout });
  await expect(
    picker.getByRole("option", { name: `Restore ${expectedModule} module tab` }),
  ).toBeVisible({ timeout });
  await field.fill("", { timeout });
  await expect(picker.getByRole("option", { name: "Create new module" }))
    .toBeVisible({ timeout });
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0, { timeout });
  await expect(trigger).toBeFocused({ timeout });
}

/** Close a picker left open by a failed repetition, so the next one starts clean. */
async function closePicker(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Module picker" }))
    .toHaveCount(0, { timeout: STEP_TIMEOUT_MS });
}

test("opens, filters, clears and closes the module picker twenty times", async ({
  page,
  seed,
  run,
  operations,
  recorder,
  probes: _probes,
}) => {
  test.setTimeout(300_000);
  const repetitions = run.repetitionsOverride ?? REPETITIONS;
  recorder.describe({
    warmups: WARMUPS,
    repetitions,
    searchTerm: seed.pickerSearchTerm,
    expectedModule: seed.pickerSearchExpectedModule,
    hiddenModuleCount: seed.hiddenModuleIds.length,
    datasetVersion: seed.datasetVersion,
    datasetSize: seed.size,
  });

  operations.startWindow("setup");
  await openWorkspace(page, SETTLE_MS);
  await openSeededModule(page, seed.navigationModules[0]!.name);
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    await pickerCycle(page, seed.pickerSearchTerm, seed.pickerSearchExpectedModule);
  }
  await settle(page, SETTLE_MS);
  operations.endWindow();

  const domBefore = await domNodeCount(page);
  operations.startWindow("measured");
  await startProbes(page, "module-picker");
  let succeeded = 0;
  const workload = async () => {
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const passed = await measuredRepetition(
        recorder,
        "pickerOpenFilterClose",
        () => pickerCycle(page, seed.pickerSearchTerm, seed.pickerSearchExpectedModule),
        () => closePicker(page),
      );
      if (passed) succeeded += 1;
    }
  };
  // CPU sampling is a diagnostic mode. It perturbs the timings recorded in the
  // same run, and the report says so rather than mixing the two silently.
  if (run.captures.includes("cpu")) {
    const directory = scenarioArtifactDirectory(run, "module-picker");
    await mkdir(directory, { recursive: true });
    const { capture } = await recordCpuProfile(page, { directory }, workload);
    recorder.addCapture("cpu", {
      profile: capture.profilePath,
      summary: capture.summaryPath,
      note: "recorded during the measured window; timings in this run carry "
        + "sampling overhead and are not low-overhead baselines",
    });
  } else {
    await workload();
  }
  const snapshot = await stopProbes(page);
  operations.endWindow();
  const domAfter = await domNodeCount(page);

  recorder.setProbes({
    ...(snapshot as Record<string, unknown>),
    capabilities: await probeCapabilities(page),
    domNodeCounts: { before: domBefore, after: domAfter },
  });
  recorder.setOperations(operations.windows());
  recorder.describe({ subscriptionStreamsAborted: operations.streamsAborted() });
  recorder.setPageErrors(await probeTotals(page));
  for (const failure of operations.failures()) recorder.fail(failure);

  recorder.describe({ succeededRepetitions: succeeded });
  // Individual repetitions are recorded whether they pass or fail. Only a
  // scenario that never once completed is a deterministic error.
  expect(succeeded, "at least one picker repetition completed").toBeGreaterThan(0);
  expect(
    windowErrors(snapshot).pageErrors,
    "page errors across the picker repetitions",
  ).toBe(0);
});
