/**
 * Command-line parsing for the profiling commands.
 *
 * Kept free of filesystem and process work so the option rules can be tested
 * directly, and so an unsupported flag fails before anything is built,
 * launched or measured.
 */

/** Scenario registry: the spec that implements it and its default workload. */
export const SCENARIOS = {
  idle: {
    spec: "performance/scenarios/idle.spec.ts",
    defaultRepetitions: 1,
    supportsCpuCapture: true,
    supportsHeapCapture: false,
  },
  "module-picker": {
    spec: "performance/scenarios/module-picker.spec.ts",
    defaultRepetitions: 20,
    supportsCpuCapture: true,
    supportsHeapCapture: false,
  },
  "module-navigation": {
    spec: "performance/scenarios/module-navigation.spec.ts",
    defaultRepetitions: 20,
    supportsCpuCapture: true,
    supportsHeapCapture: false,
  },
  "work-item-details": {
    spec: "performance/scenarios/work-item-details.spec.ts",
    defaultRepetitions: 20,
    supportsCpuCapture: true,
    supportsHeapCapture: false,
  },
  retention: {
    spec: "performance/scenarios/retention.spec.ts",
    defaultRepetitions: 5,
    supportsCpuCapture: false,
    supportsHeapCapture: true,
  },
};

/** Scenarios a plain `perf:run` measures when none is named. */
export const DEFAULT_SCENARIOS = ["idle", "module-picker"];

export const ENGINES = ["chromium", "webkit"];
export const DATASETS = ["small", "large"];
export const CAPTURES = ["cpu", "heap", "heap-snapshot", "trace"];
export const ADAPTER_PROFILES = ["debug", "release"];

/** Captures that only Chromium's DevTools protocol can produce. */
export const CHROMIUM_ONLY_CAPTURES = ["cpu", "heap", "heap-snapshot"];

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

function commaSeparated(value) {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function readPort(argv, index, flag) {
  const port = Number(readValue(argv, index, flag));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${flag} needs a TCP port between 1 and 65535`);
  }
  return port;
}

export function parsePerformanceRunOptions(argv = []) {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const options = {
    engine: "chromium",
    scenarios: [],
    dataset: "small",
    captures: [],
    repetitions: null,
    adapterProfile: "debug",
    runIdentifier: null,
    headed: false,
    allowStaleBuild: false,
    allowNoisyHost: false,
    // Null means "take the dedicated default, or the next free port after it".
    // A port named explicitly is a demand, and an occupied one fails the run
    // rather than quietly measuring somebody else's server.
    frontendPort: null,
    adapterPort: null,
  };
  for (let index = 0; index < normalized.length; index += 1) {
    const flag = normalized[index];
    switch (flag) {
      case "--engine":
        options.engine = readValue(normalized, index, flag);
        index += 1;
        break;
      case "--scenario":
        options.scenarios.push(...commaSeparated(readValue(normalized, index, flag)));
        index += 1;
        break;
      case "--dataset":
        options.dataset = readValue(normalized, index, flag);
        index += 1;
        break;
      case "--capture":
        options.captures.push(...commaSeparated(readValue(normalized, index, flag)));
        index += 1;
        break;
      case "--repetitions":
        options.repetitions = Number(readValue(normalized, index, flag));
        index += 1;
        break;
      case "--adapter-profile":
        options.adapterProfile = readValue(normalized, index, flag);
        index += 1;
        break;
      case "--run-id":
        options.runIdentifier = readValue(normalized, index, flag);
        index += 1;
        break;
      case "--headed":
        options.headed = true;
        break;
      case "--allow-stale-build":
        options.allowStaleBuild = true;
        break;
      case "--allow-noisy-host":
        options.allowNoisyHost = true;
        break;
      case "--frontend-port":
        options.frontendPort = readPort(normalized, index, flag);
        index += 1;
        break;
      case "--adapter-port":
        options.adapterPort = readPort(normalized, index, flag);
        index += 1;
        break;
      default:
        throw new Error(`Unsupported option ${flag}. ${runUsage()}`);
    }
  }
  if (options.scenarios.length === 0) options.scenarios = [...DEFAULT_SCENARIOS];
  return validateRunOptions(options);
}

function validateRunOptions(options) {
  if (!ENGINES.includes(options.engine)) {
    throw new Error(`--engine must be one of ${ENGINES.join(", ")}`);
  }
  if (!DATASETS.includes(options.dataset)) {
    throw new Error(`--dataset must be one of ${DATASETS.join(", ")}`);
  }
  if (!ADAPTER_PROFILES.includes(options.adapterProfile)) {
    throw new Error(`--adapter-profile must be one of ${ADAPTER_PROFILES.join(", ")}`);
  }
  for (const scenario of options.scenarios) {
    if (!SCENARIOS[scenario]) {
      throw new Error(
        `Unknown --scenario ${scenario}. Known scenarios: ${Object.keys(SCENARIOS).join(", ")}`,
      );
    }
  }
  const captures = [...new Set(options.captures)];
  for (const capture of captures) {
    if (!CAPTURES.includes(capture)) {
      throw new Error(`--capture must be one of ${CAPTURES.join(", ")}`);
    }
  }
  const unsupported = captures.filter((capture) =>
    CHROMIUM_ONLY_CAPTURES.includes(capture) && options.engine !== "chromium"
  );
  if (unsupported.length > 0) {
    throw new Error(
      `${unsupported.join(", ")} capture needs the Chromium DevTools protocol; `
      + `rerun with --engine chromium or drop the capture`,
    );
  }
  if (
    options.repetitions !== null
    && (!Number.isInteger(options.repetitions) || options.repetitions < 1)
  ) {
    throw new Error("--repetitions must be a positive integer");
  }
  return { ...options, scenarios: [...new Set(options.scenarios)], captures };
}

export function runUsage() {
  return "usage: npm run perf:run --workspace @worktracker/studio -- "
    + `[--engine ${ENGINES.join("|")}] [--scenario ${Object.keys(SCENARIOS).join("|")}] `
    + `[--dataset ${DATASETS.join("|")}] [--capture ${CAPTURES.join("|")}] `
    + "[--repetitions N] [--adapter-profile debug|release] [--run-id ID] "
    + "[--headed] [--allow-stale-build] [--allow-noisy-host] "
    + "[--frontend-port N] [--adapter-port N]";
}

export function parsePerformancePrepareOptions(argv = []) {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const options = { adapterProfile: "debug" };
  for (let index = 0; index < normalized.length; index += 1) {
    const flag = normalized[index];
    if (flag === "--adapter-profile") {
      options.adapterProfile = readValue(normalized, index, flag);
      index += 1;
    } else {
      throw new Error(
        `Unsupported option ${flag}. usage: npm run perf:prepare `
        + "--workspace @worktracker/studio -- [--adapter-profile debug|release]",
      );
    }
  }
  if (!ADAPTER_PROFILES.includes(options.adapterProfile)) {
    throw new Error(`--adapter-profile must be one of ${ADAPTER_PROFILES.join(", ")}`);
  }
  return options;
}

export function parsePerformanceCompareOptions(argv = []) {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const options = { baseline: null, candidate: null, informational: false };
  for (let index = 0; index < normalized.length; index += 1) {
    const flag = normalized[index];
    if (flag === "--baseline") {
      options.baseline = readValue(normalized, index, flag);
      index += 1;
    } else if (flag === "--candidate") {
      options.candidate = readValue(normalized, index, flag);
      index += 1;
    } else if (flag === "--informational") {
      options.informational = true;
    } else {
      throw new Error(`Unsupported option ${flag}. ${compareUsage()}`);
    }
  }
  if (!options.baseline || !options.candidate) {
    throw new Error(compareUsage());
  }
  return options;
}

export function compareUsage() {
  return "usage: npm run perf:compare --workspace @worktracker/studio -- "
    + "--baseline <run-dir> --candidate <run-dir> [--informational]";
}

/** Desktop confirmation drives the subset of scenarios WebDriver can reach. */
export const DESKTOP_SCENARIOS = ["idle", "module-picker", "module-navigation"];

export function parsePerformanceDesktopOptions(argv = []) {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const options = { scenarios: [], runIdentifier: null, skipBuild: false };
  for (let index = 0; index < normalized.length; index += 1) {
    const flag = normalized[index];
    if (flag === "--scenario") {
      options.scenarios.push(...commaSeparated(readValue(normalized, index, flag)));
      index += 1;
    } else if (flag === "--run-id") {
      options.runIdentifier = readValue(normalized, index, flag);
      index += 1;
    } else if (flag === "--skip-build") {
      options.skipBuild = true;
    } else {
      throw new Error(`Unsupported option ${flag}. ${desktopUsage()}`);
    }
  }
  if (options.scenarios.length === 0) options.scenarios = [...DESKTOP_SCENARIOS];
  for (const scenario of options.scenarios) {
    if (!DESKTOP_SCENARIOS.includes(scenario)) {
      throw new Error(
        `Unknown desktop --scenario ${scenario}. `
        + `Known scenarios: ${DESKTOP_SCENARIOS.join(", ")}`,
      );
    }
  }
  return { ...options, scenarios: [...new Set(options.scenarios)] };
}

export function desktopUsage() {
  return "usage: npm run perf:desktop --workspace @worktracker/studio -- "
    + `[--scenario ${DESKTOP_SCENARIOS.join("|")}] [--run-id ID] [--skip-build]`;
}
