/**
 * The in-page measurement probes.
 *
 * One self-contained function, because it has to reach the page two different
 * ways: Playwright serializes it through `page.addInitScript`, and the desktop
 * WebDriver harness evaluates the same source through `browser.execute`. It
 * therefore closes over nothing, imports nothing, and is plain ESM so both
 * worlds load exactly the same implementation.
 *
 * Three rules shape what it collects. Every metric is capability-detected, and
 * an unsupported one is reported as null with a reason rather than as zero.
 * Every buffer is bounded, so a fifteen-second idle window cannot itself
 * become the allocation the run is investigating. And the object retains
 * counters only — never a second copy of application state.
 */
export const PERFORMANCE_PROBE_GLOBAL = "__ticketryPerformanceProbes";

/** Timer-scheduling sample interval. Modest on purpose: the sampler must not become the load. */
export const SCHEDULING_DELAY_INTERVAL_MS = 100;

export function installPerformanceProbes() {
  const globalName = "__ticketryPerformanceProbes";
  const scope = window;
  if (scope[globalName]) return;

  const MAX_OBSERVER_ENTRIES = 200;
  const MAX_DELAY_SAMPLES = 1000;
  const MAX_MESSAGES = 50;
  const DELAY_INTERVAL_MS = 100;

  const supportedTypes = (typeof PerformanceObserver !== "undefined"
    && PerformanceObserver.supportedEntryTypes) || [];

  function capabilityFor(type) {
    return supportedTypes.indexOf(type) === -1
      ? {
        supported: false,
        reason: 'this engine does not list "' + type
          + '" in PerformanceObserver.supportedEntryTypes',
      }
      : { supported: true, reason: null };
  }

  const performanceMemory = performance.memory;
  const capabilities = {
    longtask: capabilityFor("longtask"),
    event: capabilityFor("event"),
    layoutShift: capabilityFor("layout-shift"),
    memory: performanceMemory
      ? { supported: true, reason: null }
      : {
        supported: false,
        reason: "performance.memory is a Chromium extension and is absent here",
      },
  };

  const totals = { pageErrors: 0, consoleErrors: 0, messages: [] };

  function recordMessage(kind, message) {
    if (totals.messages.length < MAX_MESSAGES) {
      totals.messages.push(kind + ": " + String(message).slice(0, 300));
    }
  }

  const onError = (event) => {
    totals.pageErrors += 1;
    recordMessage("error", event.message);
  };
  const onRejection = (event) => {
    totals.pageErrors += 1;
    recordMessage("unhandledrejection", event.reason);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const originalConsoleError = console.error.bind(console);
  console.error = function () {
    totals.consoleErrors += 1;
    recordMessage("console.error", Array.prototype.map.call(arguments, String).join(" "));
    originalConsoleError.apply(null, arguments);
  };

  let active = null;
  const observers = [];
  let delayTimer = null;

  function observe(type, handle, options) {
    if (!capabilityFor(type).supported) return;
    try {
      const observer = new PerformanceObserver((list) => handle(list.getEntries()));
      observer.observe(Object.assign({ type, buffered: false }, options || {}));
      observers.push(observer);
    } catch (error) {
      // A listed entry type can still refuse the options this call passes.
      // Leaving it unobserved keeps the metric reported as unavailable.
      void error;
    }
  }

  function teardown() {
    for (const observer of observers) {
      try {
        observer.disconnect();
      } catch (error) {
        // A disconnected observer is the desired state either way.
        void error;
      }
    }
    observers.length = 0;
    if (delayTimer !== null) clearInterval(delayTimer);
    delayTimer = null;
  }

  function metric(capability, value) {
    return capability.supported
      ? { value, reason: null }
      : { value: null, reason: capability.reason };
  }

  function distribution(samples) {
    if (samples.length === 0) return null;
    const sorted = samples.slice().sort((left, right) => left - right);
    const at = (fraction) =>
      sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
    return {
      count: sorted.length,
      min: sorted[0],
      p50: at(0.5),
      p95: at(0.95),
      max: sorted[sorted.length - 1],
    };
  }

  function snapshotOf(current) {
    return {
      label: current.label,
      durationMs: performance.now() - current.startedAt,
      longTasks: metric(capabilities.longtask, {
        count: current.longTasks.count,
        totalMs: current.longTasks.totalMs,
        maxMs: current.longTasks.maxMs,
        entries: current.longTasks.entries,
      }),
      eventTiming: metric(capabilities.event, {
        count: current.eventTiming.count,
        maxDurationMs: current.eventTiming.maxDurationMs,
        entries: current.eventTiming.entries,
        note: "Event Timing entries above the duration threshold. This is not "
          + "an INP result and must not be reported as one.",
      }),
      layoutShift: metric(capabilities.layoutShift, {
        count: current.layoutShift.count,
        totalScore: current.layoutShift.totalScore,
      }),
      schedulingDelay: {
        value: {
          intervalMs: DELAY_INTERVAL_MS,
          count: current.delay.count,
          maxMs: current.delay.maxMs,
          droppedSamples: current.delay.dropped,
          distribution: distribution(current.delay.samples),
          note: "Lateness of a fixed-interval timer, sampled in the page. It is "
            + "an event-loop occupancy proxy, not a scheduler guarantee.",
        },
        reason: null,
      },
      memory: capabilities.memory.supported
        ? {
          value: {
            usedJSHeapSize: performanceMemory.usedJSHeapSize,
            totalJSHeapSize: performanceMemory.totalJSHeapSize,
            jsHeapSizeLimit: performanceMemory.jsHeapSizeLimit,
            note: "performance.memory is quantized by the browser, so small "
              + "movements are invisible here. The retention scenario reads "
              + "precise sizes through CDP Runtime.getHeapUsage instead.",
          },
          reason: null,
        }
        : { value: null, reason: capabilities.memory.reason },
      marks: current.marks,
      errors: {
        pageErrors: totals.pageErrors - current.errorBaseline.pageErrors,
        consoleErrors: totals.consoleErrors - current.errorBaseline.consoleErrors,
        messages: totals.messages.slice(0, MAX_MESSAGES),
      },
    };
  }

  scope[globalName] = {
    version: 1,
    capabilities,

    start(label) {
      teardown();
      const current = {
        label,
        startedAt: performance.now(),
        errorBaseline: {
          pageErrors: totals.pageErrors,
          consoleErrors: totals.consoleErrors,
        },
        longTasks: { count: 0, totalMs: 0, maxMs: 0, entries: [] },
        eventTiming: { count: 0, maxDurationMs: 0, entries: [] },
        layoutShift: { count: 0, totalScore: 0 },
        delay: { count: 0, maxMs: 0, samples: [], dropped: 0 },
        marks: [],
      };
      active = current;
      observe("longtask", (entries) => {
        for (const entry of entries) {
          current.longTasks.count += 1;
          current.longTasks.totalMs += entry.duration;
          if (entry.duration > current.longTasks.maxMs) {
            current.longTasks.maxMs = entry.duration;
          }
          if (current.longTasks.entries.length < MAX_OBSERVER_ENTRIES) {
            current.longTasks.entries.push({
              startTime: entry.startTime,
              duration: entry.duration,
              name: entry.name,
            });
          }
        }
      });
      observe("event", (entries) => {
        for (const entry of entries) {
          current.eventTiming.count += 1;
          if (entry.duration > current.eventTiming.maxDurationMs) {
            current.eventTiming.maxDurationMs = entry.duration;
          }
          if (current.eventTiming.entries.length < MAX_OBSERVER_ENTRIES) {
            current.eventTiming.entries.push({
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        }
      }, { durationThreshold: 16 });
      observe("layout-shift", (entries) => {
        for (const entry of entries) {
          if (entry.hadRecentInput) continue;
          current.layoutShift.count += 1;
          current.layoutShift.totalScore += entry.value;
        }
      });
      let expected = performance.now() + DELAY_INTERVAL_MS;
      delayTimer = setInterval(() => {
        const now = performance.now();
        const lateness = now - expected;
        expected = now + DELAY_INTERVAL_MS;
        current.delay.count += 1;
        if (lateness > current.delay.maxMs) current.delay.maxMs = lateness;
        if (current.delay.samples.length >= MAX_DELAY_SAMPLES) {
          current.delay.samples.shift();
          current.delay.dropped += 1;
        }
        current.delay.samples.push(lateness);
      }, DELAY_INTERVAL_MS);
      return current.label;
    },

    mark(name) {
      if (active && active.marks.length < MAX_OBSERVER_ENTRIES) {
        active.marks.push({ name, at: performance.now() });
      }
    },

    snapshot() {
      return active ? snapshotOf(active) : null;
    },

    stop() {
      if (!active) {
        teardown();
        return null;
      }
      const result = snapshotOf(active);
      teardown();
      active = null;
      return result;
    },

    domNodeCount() {
      return document.getElementsByTagName("*").length;
    },

    /**
     * Two animation frames after the caller's action. It proves a render
     * opportunity passed, not that the display physically painted; reports
     * carry that label.
     */
    afterTwoFrames() {
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve(performance.now()));
        });
      });
    },

    /** The terminal renderer's own counters, when a terminal surface exists. */
    rendererMeasurements() {
      const read = scope.__ticketryRendererMeasurements;
      if (typeof read !== "function") {
        return {
          value: null,
          reason: "no terminal renderer published measurements in this window",
        };
      }
      return {
        value: read(),
        reason: null,
        note: "Renderer-owned counters. They describe the terminal renderer's "
          + "own work and must not be added to JS heap bytes or to an OS "
          + "physical footprint.",
      };
    },

    totals() {
      return {
        pageErrors: totals.pageErrors,
        consoleErrors: totals.consoleErrors,
        messages: totals.messages.slice(0, MAX_MESSAGES),
      };
    },

    dispose() {
      teardown();
      active = null;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      console.error = originalConsoleError;
      delete scope[globalName];
    },
  };
}

/**
 * The same probes as an immediately-invoked source string, for drivers that
 * evaluate script text instead of serializing a function (WebdriverIO).
 */
export function performanceProbeSource() {
  return `(${installPerformanceProbes.toString()})();`;
}
