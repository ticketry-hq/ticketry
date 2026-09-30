import { mkdir } from "node:fs/promises";

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
 * Work-item details.
 *
 * Open up to twenty known top-level rows and verify each selection, including
 * the rows carrying the fixed 20 KB description. Verifying the selected item
 * is what makes the timing meaningful: an unverified click measures the click,
 * not the view.
 *
 * The count is whatever the fixture offers at top level, and it is recorded.
 * Padding it with rows collapsed under a parent would measure a wait, not a
 * detail view.
 */
const WARMUPS = 2;
const SETTLE_MS = 2_000;

test.use({ scenarioName: "work-item-details" });

test("opens twenty known work items and verifies each selection", async ({
  page,
  seed,
  run,
  operations,
  recorder,
  probes: _probes,
}) => {
  test.setTimeout(300_000);
  const rows = seed.detailWorkItems.slice(0, run.repetitionsOverride ?? 20);
  recorder.describe({
    warmups: WARMUPS,
    repetitions: rows.length,
    largeDescriptionRows: rows.filter((row) => row.hasLargeDescription).length,
    largeDescriptionBytes: seed.spec.largeDescriptionBytes,
    datasetVersion: seed.datasetVersion,
    datasetSize: seed.size,
  });

  const openRow = async (name: string) => {
    await page.getByRole("treeitem", { name: new RegExp(escapeForRegExp(name)) })
      .first()
      .click({ timeout: STEP_TIMEOUT_MS });
    await expect(page.getByTestId("issue-name"))
      .toContainText(name, { timeout: STEP_TIMEOUT_MS });
  };

  operations.startWindow("setup");
  await openWorkspace(page, SETTLE_MS);
  await openSeededModule(page, seed.navigationModules[0]!.name);
  for (let warmup = 0; warmup < WARMUPS && warmup < rows.length; warmup += 1) {
    await openRow(rows[warmup]!.name);
  }
  await settle(page, SETTLE_MS);
  operations.endWindow();

  const domBefore = await domNodeCount(page);
  operations.startWindow("measured");
  await startProbes(page, "work-item-details");
  let succeeded = 0;
  const workload = async () => {
    for (const row of rows) {
      const passed = await measuredRepetition(
        recorder,
        row.hasLargeDescription
          ? "workItemOpenToReady.largeDescription"
          : "workItemOpenToReady",
        () => openRow(row.name),
      );
      if (passed) succeeded += 1;
    }
  };
  if (run.captures.includes("cpu")) {
    const directory = scenarioArtifactDirectory(run, "work-item-details");
    await mkdir(directory, { recursive: true });
    const { capture } = await recordCpuProfile(page, { directory }, workload);
    recorder.addCapture("cpu", {
      profile: capture.profilePath,
      summary: capture.summaryPath,
      note: "recorded during the measured window; these timings carry sampling "
        + "overhead and are not low-overhead baselines",
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
  expect(succeeded, "at least one detail repetition completed").toBeGreaterThan(0);
  expect(
    windowErrors(snapshot).pageErrors,
    "page errors across the detail repetitions",
  ).toBe(0);
});

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
