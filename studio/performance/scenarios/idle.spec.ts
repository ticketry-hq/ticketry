import {
  domNodeCount,
  expect,
  openSeededModule,
  openWorkspace,
  performanceTest as test,
  probeCapabilities,
  probeTotals,
  rendererMeasurements,
  settle,
  startProbes,
  stopProbes,
  windowErrors,
} from "../fixtures/scenario";

/**
 * Idle workspace.
 *
 * The question is what Ticketry does when nobody is doing anything: an
 * application that occupies its main thread for fifteen uninterrupted seconds
 * after settling is the September incident's shape. The idle window is a
 * deliberate timed observation and is never used as a readiness signal — the
 * scenario asserts the DOM state it expects first, then watches the clock.
 */
const IDLE_WINDOW_MS = 15_000;
const SETTLE_MS = 3_000;

test.use({ scenarioName: "idle" });

test("records fifteen settled seconds of an open populated module", async ({
  page,
  seed,
  operations,
  recorder,
  probes: _probes,
}) => {
  test.setTimeout(120_000);
  recorder.describe({
    idleWindowMs: IDLE_WINDOW_MS,
    settleMs: SETTLE_MS,
    module: seed.navigationModules[0]?.name,
    datasetVersion: seed.datasetVersion,
    datasetSize: seed.size,
    workItemsInModule: seed.spec.workItemsPerModule,
  });

  operations.startWindow("setup");
  await openWorkspace(page, SETTLE_MS);
  await openSeededModule(page, seed.navigationModules[0]!.name);
  await expect(page.getByRole("treeitem").first()).toBeVisible();
  await settle(page, SETTLE_MS);
  operations.endWindow();

  const domBefore = await domNodeCount(page);
  operations.startWindow("idle");
  await startProbes(page, "idle");
  await settle(page, IDLE_WINDOW_MS);
  const snapshot = await stopProbes(page);
  operations.endWindow();
  const domAfter = await domNodeCount(page);

  recorder.setProbes({
    ...(snapshot as Record<string, unknown>),
    capabilities: await probeCapabilities(page),
    domNodeCounts: { before: domBefore, after: domAfter },
    renderer: await rendererMeasurements(page),
  });
  recorder.setOperations(operations.windows());
  recorder.describe({ subscriptionStreamsAborted: operations.streamsAborted() });
  recorder.setPageErrors(await probeTotals(page));
  for (const failure of operations.failures()) recorder.fail(failure);

  // The idle window is evidence, not a pass/fail gate. The one thing it does
  // assert is that nothing broke while nobody was looking — and only within
  // the measured window. Errors during setup are recorded in `pageErrors`
  // instead, because they describe the fixture, not the measurement.
  expect(
    windowErrors(snapshot).pageErrors,
    "page errors during the idle window",
  ).toBe(0);
});
