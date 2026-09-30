import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compareRuns } from "../../performance/report/compare.mjs";
import { renderComparisonMarkdown } from "../../performance/report/markdown.mjs";
import { RUN_FILES } from "../../performance/report/schema.mjs";
import { compareUsage, parsePerformanceCompareOptions } from "./options.mjs";

/**
 * Compare two profiling runs.
 *
 * The command's job is to say when a comparison is not a comparison. Two runs
 * from different engines, machines, build modes, datasets, scenario parameters
 * or instrumentation modes are refused unless the caller explicitly asks for
 * an informational comparison, and no threshold turns a delta into a verdict.
 */
export function loadRunReport(directory) {
  const file = path.join(path.resolve(directory), RUN_FILES.summaryJson);
  if (!existsSync(file)) {
    throw new Error(
      `${directory} has no ${RUN_FILES.summaryJson}; point at a completed run directory`,
    );
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

export function main(argv = process.argv.slice(2)) {
  const options = parsePerformanceCompareOptions(argv);
  const baseline = loadRunReport(options.baseline);
  const candidate = loadRunReport(options.candidate);
  const comparison = compareRuns(baseline, candidate, {
    informational: options.informational,
  });
  const output = path.join(path.resolve(options.candidate), "comparison.md");
  writeFileSync(output, renderComparisonMarkdown(comparison));
  writeFileSync(
    path.join(path.resolve(options.candidate), "comparison.json"),
    `${JSON.stringify(comparison, null, 2)}\n`,
  );
  process.stdout.write(renderComparisonMarkdown(comparison));
  console.log(`[performance] comparison written to ${output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[performance] comparison failed: ${error.message}`);
    console.error(compareUsage());
    process.exitCode = 1;
  }
}
