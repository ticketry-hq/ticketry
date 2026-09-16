import {
  performanceProbeSource,
} from "../../performance/collectors/browser-probes.mjs";

/**
 * The desktop counterparts of the browser scenarios.
 *
 * They drive the same visible actions — open a populated module, work the
 * module picker, alternate between two modules — through WebdriverIO instead
 * of Playwright, so the two surfaces can be read side by side. Every metric is
 * capability-detected on arrival: a WKWebView that does not expose an entry
 * type reports it unavailable rather than as a zero.
 */
export { performanceProbeSource as desktopProbeSource };

const IDLE_WINDOW_MS = 15_000;
const PICKER_WARMUPS = 3;
const PICKER_REPETITIONS = 20;
const NAVIGATION_REPETITIONS = 20;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function probe(browser, expression) {
  return await browser.execute(
    `return window.__ticketryPerformanceProbes ? (${expression}) : null;`,
  );
}

async function waitFor(browser, selector, { timeout = 20_000, message } = {}) {
  const element = await browser.$(selector);
  await element.waitForDisplayed({ timeout, timeoutMsg: message ?? `${selector} never appeared` });
  return element;
}

async function openModule(browser, moduleName) {
  const tab = await waitFor(browser, `[role="tab"][aria-label="${moduleName}"]`, {
    message: `the ${moduleName} module tab never appeared`,
  });
  await tab.click();
  await browser.waitUntil(
    async () => await tab.getAttribute("aria-selected") === "true",
    { timeout: 20_000, timeoutMsg: `the ${moduleName} tab never became selected` },
  );
  await waitFor(browser, '[data-testid="module-workspace-region"]');
}

async function pickerCycle(browser, search, expectedModule) {
  const trigger = await waitFor(browser, '[aria-label="Open module picker"]');
  await trigger.click();
  const field = await waitFor(browser, '[aria-label="Search modules"]');
  await field.setValue(search);
  await waitFor(browser, `[aria-label="Restore ${expectedModule} module tab"]`, {
    message: `the picker never filtered down to ${expectedModule}`,
  });
  await browser.keys(["Escape"]);
  await browser.waitUntil(
    async () => (await browser.$$('[role="dialog"][aria-label="Module picker"]')).length === 0,
    { timeout: 10_000, timeoutMsg: "the module picker never closed" },
  );
}

/**
 * End-to-end automation latency, on Node's monotonic clock. It includes
 * WebDriver round trips and is neither INP nor a paint measurement.
 */
async function timed(timings, name, action) {
  const started = process.hrtime.bigint();
  try {
    await action();
    push(timings, name, Number(process.hrtime.bigint() - started) / 1e6);
  } catch (error) {
    push(timings, `${name}.failed`, Number(process.hrtime.bigint() - started) / 1e6);
    throw error;
  }
}

function push(timings, name, value) {
  (timings[name] ??= []).push(value);
}

async function finish(browser, timings, parameters, extra = {}) {
  return {
    status: "passed",
    parameters,
    timings,
    probes: {
      ...(await probe(browser, "window.__ticketryPerformanceProbes.stop()") ?? {}),
      capabilities: await probe(browser, "window.__ticketryPerformanceProbes.capabilities"),
      renderer: await probe(
        browser,
        "window.__ticketryPerformanceProbes.rendererMeasurements()",
      ),
    },
    pageErrors: await probe(browser, "window.__ticketryPerformanceProbes.totals()"),
    operationWindows: {},
    operationCountsUnavailable:
      "GraphQL travels over Tauri IPC in the desktop shell, so there is no HTTP "
      + "request the runner can count here",
    failures: [],
    ...extra,
  };
}

export const DESKTOP_SCENARIO_SCRIPTS = {
  async idle({ browser, fixture, settleMs }) {
    const timings = {};
    await openModule(browser, fixture.navigationModules[0].name);
    await sleep(settleMs);
    const domBefore = await probe(
      browser,
      "window.__ticketryPerformanceProbes.domNodeCount()",
    );
    await probe(browser, 'window.__ticketryPerformanceProbes.start("idle")');
    await sleep(IDLE_WINDOW_MS);
    const observations = await finish(browser, timings, {
      idleWindowMs: IDLE_WINDOW_MS,
      settleMs,
      module: fixture.navigationModules[0].name,
      datasetVersion: fixture.datasetVersion,
    });
    const domAfter = await probe(
      browser,
      "window.__ticketryPerformanceProbes.domNodeCount()",
    );
    observations.probes.domNodeCounts = { before: domBefore, after: domAfter };
    return observations;
  },

  async "module-picker"({ browser, fixture, settleMs }) {
    const timings = {};
    await openModule(browser, fixture.navigationModules[0].name);
    for (let warmup = 0; warmup < PICKER_WARMUPS; warmup += 1) {
      await pickerCycle(browser, fixture.pickerSearchTerm, fixture.pickerSearchExpectedModule);
    }
    await sleep(settleMs);
    await probe(browser, 'window.__ticketryPerformanceProbes.start("module-picker")');
    for (let repetition = 0; repetition < PICKER_REPETITIONS; repetition += 1) {
      await timed(timings, "pickerOpenFilterClose", () =>
        pickerCycle(
          browser,
          fixture.pickerSearchTerm,
          fixture.pickerSearchExpectedModule,
        ));
    }
    return await finish(browser, timings, {
      warmups: PICKER_WARMUPS,
      repetitions: PICKER_REPETITIONS,
      searchTerm: fixture.pickerSearchTerm,
      datasetVersion: fixture.datasetVersion,
    });
  },

  async "module-navigation"({ browser, fixture, settleMs }) {
    const timings = {};
    const [first, second] = fixture.navigationModules;
    await openModule(browser, first.name);
    await openModule(browser, second.name);
    await sleep(settleMs);
    await probe(browser, 'window.__ticketryPerformanceProbes.start("module-navigation")');
    for (let repetition = 0; repetition < NAVIGATION_REPETITIONS; repetition += 1) {
      const target = repetition % 2 === 0 ? first : second;
      await timed(timings, "moduleSelectionToReady", () => openModule(browser, target.name));
    }
    return await finish(browser, timings, {
      warmups: 1,
      repetitions: NAVIGATION_REPETITIONS,
      modules: [first.name, second.name],
      datasetVersion: fixture.datasetVersion,
    });
  },
};
