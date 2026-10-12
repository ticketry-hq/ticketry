/** The only edition tag: a case that exists only in core builds. */
export const coreEditionTag = "@edition-core";

/**
 * Rule 10: each entry declares its editions, and `@edition-core` cases line up
 * with the `(core)` sub-features that cite them, so a Pocock run can drop
 * exactly the cases whose surfaces it does not compile.
 */
export function validateFeatureEditions(registry, report) {
  for (const feature of registry.features) {
    for (const problem of feature.editionProblems ?? []) report(10, feature.path, problem);
    if (!feature.editions) continue;
    const includesCore = feature.editions.includes("core");
    const coreRows = new Set(feature.coreSubFeatures ?? []);
    if (!includesCore) for (const id of coreRows) report(10, feature.path, `core-only sub-feature ${id} in a feature without core`);
    const suitePath = feature.suite?.path;
    for (const testCase of feature.cases) {
      const [caseId] = testCase.ids;
      for (const tag of testCase.editionTags ?? []) if (tag !== coreEditionTag) report(10, suitePath, `unknown edition tag ${tag} on @case-${caseId}`);
      const tagged = (testCase.editionTags ?? []).includes(coreEditionTag);
      const citingRows = [...new Set(feature.cellCitations.filter((cell) => cell.ids.includes(caseId)).map((cell) => cell.subFeature))];
      if (tagged && !includesCore) report(10, suitePath, `@edition-core case @case-${caseId} in a feature without core (${feature.path})`);
      else if (tagged) for (const row of citingRows.filter((row) => !coreRows.has(row))) report(10, suitePath, `@edition-core case @case-${caseId} is cited by unmarked sub-feature ${row}; mark it (core) in ${feature.path}`);
      if (!tagged && feature.editions.includes("pocock") && citingRows.length && citingRows.every((row) => coreRows.has(row))) {
        report(10, suitePath, `case @case-${caseId} covers only core-only sub-features and needs @edition-core`);
      }
    }
  }
}
