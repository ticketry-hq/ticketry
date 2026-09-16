/**
 * The synthetic datasets a profiling run measures against.
 *
 * Names are stable and derived from an index so a scenario can address a known
 * row without assuming a sequence number the database chose. The version below
 * changes whenever the shape changes, and every run records it: comparing two
 * runs seeded from different dataset versions is not a comparison.
 */
export const DATASET_VERSION = 3;

export interface DatasetSpec {
  size: "small" | "large";
  version: number;
  moduleCount: number;
  workItemsPerModule: number;
  /** Modules left as visible tabs. The rest stay hidden so the picker has rows to filter. */
  visibleModuleTabs: number;
  /** Every nth work item carries the large description. */
  largeDescriptionEveryNth: number;
  largeDescriptionBytes: number;
  /** Parent/child groups per module: the first item adopts the next two. */
  childGroupsPerModule: number;
  /** Every nth item is walked one transition; every 2nth is walked twice. */
  transitionEveryNth: number;
  seedConcurrency: number;
}

export const DATASET_SPECS: Record<string, DatasetSpec> = {
  small: {
    size: "small",
    version: DATASET_VERSION,
    moduleCount: 5,
    workItemsPerModule: 20,
    visibleModuleTabs: 2,
    largeDescriptionEveryNth: 5,
    largeDescriptionBytes: 20 * 1024,
    childGroupsPerModule: 1,
    transitionEveryNth: 3,
    seedConcurrency: 4,
  },
  large: {
    size: "large",
    version: DATASET_VERSION,
    moduleCount: 25,
    workItemsPerModule: 80,
    visibleModuleTabs: 2,
    largeDescriptionEveryNth: 5,
    largeDescriptionBytes: 20 * 1024,
    childGroupsPerModule: 2,
    transitionEveryNth: 3,
    seedConcurrency: 4,
  },
};

export function datasetSpec(size: string): DatasetSpec {
  const spec = DATASET_SPECS[size];
  if (!spec) {
    throw new Error(
      `unknown dataset ${size}; known datasets: ${Object.keys(DATASET_SPECS).join(", ")}`,
    );
  }
  return spec;
}

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/** `moduleIndex` and `itemIndex` are zero-based. */
export function moduleName(moduleIndex: number): string {
  return `Perf Module ${pad(moduleIndex + 1, 2)}`;
}

export function workItemName(moduleIndex: number, itemIndex: number): string {
  return `Perf ${pad(moduleIndex + 1, 2)}-${pad(itemIndex + 1, 3)} Work Item`;
}

/**
 * A deterministic 20 KB description. Repeating a sentence keeps the byte count
 * exact while leaving the text readable in a screenshot of a failure.
 */
export function largeDescription(bytes: number, seed: string): string {
  const sentence = `Synthetic profiling description for ${seed}. `;
  const repeats = Math.ceil(bytes / sentence.length);
  return sentence.repeat(repeats).slice(0, bytes);
}

/** A search string that matches exactly one hidden module in this dataset. */
export function pickerSearchTerm(spec: DatasetSpec): string {
  return moduleName(spec.moduleCount - 1);
}

/** The two modules the navigation scenario alternates between: the visible tabs. */
export function navigationModuleNames(spec: DatasetSpec): [string, string] {
  if (spec.visibleModuleTabs < 2) {
    throw new Error("module navigation needs at least two visible module tabs");
  }
  return [moduleName(0), moduleName(1)];
}

export function expectedCounts(spec: DatasetSpec) {
  return {
    modules: spec.moduleCount,
    workItems: spec.moduleCount * spec.workItemsPerModule,
    visibleModuleTabs: spec.visibleModuleTabs,
    hiddenModuleTabs: spec.moduleCount - spec.visibleModuleTabs,
  };
}
