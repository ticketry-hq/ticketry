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
  windowErrors,
} from "../fixtures/scenario";

/**
 * Module navigation.
 *
 * Alternate between two populated modules and record selection-to-asserted-
 * ready. DOM node count is taken at the window boundaries only; counting it
 * per interaction would measure the counting.
 */
const WARMUPS = 3;
const REPETITIONS = 20;
const SETTLE_MS = 2_000;

test.use({ scenarioName: "module-navigation" });

test("alternates between two populated modules twenty times", async ({
  page,
  seed,
  run,
  operations,
  recorder,
  probes: _probes,
}) => {
  test.setTimeout(300_000);
  const repetitions = run.repetitionsOverride ?? REPETITIONS;
  const [first, second] = seed.navigationModules;
  expect(first?.name, "the first navigation module").toBeTruthy();
  expect(second?.name, "the second navigation module").toBeTruthy();
  recorder.describe({
    warmups: WARMUPS,
    repetitions,
    modules: [first!.name, second!.name],
    workItemsPerModule: seed.spec.workItemsPerModule,
    datasetVersion: seed.datasetVersion,
    datasetSize: seed.size,
  });

  operations.startWindow("setup");
  await openWorkspace(page, SETTLE_MS);
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    await openSeededModule(page, first!.name);
    await openSeededModule(page, second!.name);
  }
  await settle(page, SETTLE_MS);
  operations.endWindow();

  const domBefore = await domNodeCount(page);
  operations.startWindow("measured");
  await startProbes(page, "module-navigation");
  let succeeded = 0;
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    const target = repetition % 2 === 0 ? first! : second!;
    const passed = await measuredRepetition(recorder, "moduleSelectionToReady", async () => {
      await openSeededModule(page, target.name);
      await expect(page.getByRole("treeitem").first()).toBeVisible();
    });
    if (passed) succeeded += 1;
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
  expect(succeeded, "at least one navigation repetition completed").toBeGreaterThan(0);
  expect(
    windowErrors(snapshot).pageErrors,
    "page errors across the navigation repetitions",
  ).toBe(0);
});
