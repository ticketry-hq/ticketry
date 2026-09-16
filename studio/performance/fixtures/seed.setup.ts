import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { RUN_FILES } from "../report/schema.mjs";
import { fixturePath, performanceRunContext } from "./run-context";
import { seedPerformanceWorkspace } from "./seed";

/**
 * Seeding runs once per run, before any scenario and outside every measured
 * window. It writes the fixture description the scenarios address by name and
 * identity, and it reports its own duration separately so nobody mistakes seed
 * time for interaction time.
 */
test("seeds the synthetic profiling workspace", async ({ request }) => {
  test.setTimeout(15 * 60_000);
  const context = performanceRunContext();
  const fixture = await seedPerformanceWorkspace(request, context.dataset);

  expect(
    fixture.counts.createdModules,
    "every planned module was created",
  ).toBe(fixture.counts.expected.modules);
  expect(
    fixture.counts.observedWorkItems,
    `the project query returned every seeded work item; `
      + `expected ${fixture.counts.expected.workItems}`,
  ).toBe(fixture.counts.expected.workItems);
  expect(fixture.navigationModules.every((module) => module.id !== "")).toBe(true);
  // Top-level rows only, so a module whose items include parent/child groups
  // offers fewer than its full item count. The scenario records how many it
  // actually opened rather than padding the number.
  expect(fixture.detailWorkItems.length).toBeGreaterThanOrEqual(
    Math.min(20, fixture.spec.workItemsPerModule - fixture.spec.childGroupsPerModule * 2),
  );

  await mkdir(context.runDirectory, { recursive: true });
  await writeFile(
    fixturePath(context),
    `${JSON.stringify({ file: RUN_FILES.fixture, ...fixture }, null, 2)}\n`,
  );
  // eslint-disable-next-line no-console -- the run log records seed cost.
  console.log(
    `[performance] seeded ${fixture.size} dataset v${fixture.datasetVersion} in `
    + `${fixture.seedDurationMs} ms `
    + `(${fixture.counts.observedModules} modules, `
    + `${fixture.counts.observedWorkItems} work items)`,
  );
});
