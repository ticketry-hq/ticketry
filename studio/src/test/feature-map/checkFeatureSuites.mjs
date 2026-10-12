import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { deriveFeatureRegistry } from "./featureSuites.mjs";
import { validateFeatureEditions } from "./checkFeatureEditions.mjs";

export function checkFeatureSuites(mapDirectory, e2eDirectory, repositoryRoot) {
  const registry = deriveFeatureRegistry(mapDirectory, e2eDirectory, repositoryRoot);
  const paths = [...registry.features.flatMap((feature) => [feature.suite?.path]), ...registry.nonFeatureSpecs.map((spec) => spec.path)].filter(Boolean);
  return validateFeatureSuites(registry, new Set(paths.filter((path) => existsSync(resolve(repositoryRoot, path)))));
}

/** Pure contract check over the derived registry and known existing paths. */
export function validateFeatureSuites(registry, existingPaths) {
  const violations = [];
  const report = (rule, path, message) => violations.push({ rule, path, message: `${path}: rule ${rule}: ${message}` });
  for (const feature of registry.features) {
    if (feature.suiteLines.length !== 1) report(1, feature.path, feature.suiteLines.length === 0 ? "missing Suite: line" : `extra Suite: lines (${feature.suiteLines.length})`);
    if (!feature.suite) {
      if (feature.suiteLines.length) report(1, feature.path, `invalid Suite: ${feature.suiteLines.join("; ")}`);
      continue;
    }
    const expected = `studio/e2e/features/${feature.id}.spec.ts`;
    if (feature.suite.exclusion) {
      if (feature.coverage.columns.length || feature.coverage.rows.length) report(1, feature.path, "extra coverage table for excluded entry");
      if (!feature.suite.reason?.trim()) report(1, feature.path, `missing reason for excluded (${feature.suite.exclusion})`);
      if (registry.suites.some((suite) => suite.path === expected)) report(1, feature.path, `extra suite ${expected} for excluded feature`);
    } else {
      if (feature.suite.path !== expected) report(1, feature.path, `expected Suite: ${expected}; extra path ${feature.suite.path}`);
      if (!existingPaths.has(feature.suite.path)) report(1, feature.path, `missing suite file ${feature.suite.path}`);
      const columns = ["Sub-feature", "Success", "Cancel", "Error", "Empty", "Entry points", "Persistence"];
      for (const column of columns) if (!feature.coverage.columns.includes(column)) report(6, feature.path, `missing coverage column ${column}`);
      for (const column of feature.coverage.columns) if (!columns.includes(column)) report(6, feature.path, `extra coverage column ${column}`);
      for (const column of new Set(feature.coverage.columns)) if (feature.coverage.columns.filter((item) => item === column).length > 1) report(6, feature.path, `duplicate coverage column ${column}`);
      const rowIds = feature.coverage.rows.map((row) => row.id);
      for (const id of feature.subFeatures) if (!rowIds.includes(id)) report(6, feature.path, `missing coverage row ${id}`);
      for (const id of rowIds) if (!feature.subFeatures.includes(id)) report(6, feature.path, `extra coverage row ${id}`);
      for (const id of new Set(rowIds)) if (rowIds.filter((item) => item === id).length > 1) report(6, feature.path, `duplicate coverage row ${id}`);
      const suite = registry.suites.find((item) => item.path === feature.suite.path);
      const citedCases = new Set(feature.cellCitations.flatMap((cell) => cell.ids));
      const ownCases = new Set((suite?.cases ?? []).flatMap((item) => item.ids));
      for (const id of ownCases) if (!citedCases.has(id)) report(8, feature.suite.path, `uncited case @case-${id}; missing citation in ${feature.path}`);
      for (const row of feature.coverage.rows) {
        if (row.cells.length !== feature.coverage.columns.length - 1) report(7, feature.path, `row ${row.id} has ${row.cells.length} cells; expected ${feature.coverage.columns.length - 1}`);
        for (let index = 1; index < feature.coverage.columns.length; index++) {
          const cell = row.cells[index - 1]?.trim() ?? "";
          const label = `${row.id} / ${feature.coverage.columns[index]}`;
          if (/^(?:n\/a|desktop-only|manual):\s*\S[^]*$/.test(cell)) continue;
          if (!/^@case-[a-z0-9]+(?:-[a-z0-9]+)*(?:[\s,]+@case-[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(cell)) {
            report(7, feature.path, `invalid coverage cell ${label}: ${cell || "<empty>"}`);
            continue;
          }
          for (const tag of cell.matchAll(/@case-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) if (!ownCases.has(tag[1])) report(7, feature.path, `${label} cites missing case ${tag[0]} in ${feature.suite.path}`);
        }
      }
    }
  }
  validateFeatureEditions(registry, report);
  const caseOwners = new Map();
  for (const suite of registry.suites) {
    for (const violation of suite.violations) report(violation.rule, violation.path, violation.message.replace(/^.*?: rule \d+: /, ""));
    const id = suite.path.split("/").at(-1).replace(/\.spec\.ts$/, "");
    if (suite.declarations.length !== 1) report(3, suite.path, `expected one top-level featureSuite('${id}'); found ${suite.declarations.length} declarations`);
    for (const declaration of suite.declarations) {
      if (!declaration.topLevel) report(3, suite.path, `featureSuite('${declaration.id}') is not top-level`);
      if (declaration.id !== id) report(3, suite.path, `missing feature declaration '${id}'; extra '${declaration.id}'`);
    }
    for (const testCase of suite.cases) if (!testCase.insideDeclaration) report(3, suite.path, `case outside featureSuite: ${testCase.title ?? "<computed>"}`);
    for (const testCase of suite.cases) {
      if (!testCase.literalTitle) report(4, suite.path, `computed case title ${testCase.title ?? "<computed>"}`);
      if (!testCase.literalTags) report(4, suite.path, `computed case tags for ${testCase.title ?? "<computed>"}`);
      if (testCase.ids.length !== 1) report(4, suite.path, `case '${testCase.title}' requires exactly one @case- tag; found ${testCase.tags.join(", ") || "none"}`);
      for (const caseId of testCase.ids) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(caseId)) report(4, suite.path, `invalid case identifier ${caseId}`);
        if (caseOwners.has(caseId)) report(4, suite.path, `duplicate case identifier ${caseId}; first declared in ${caseOwners.get(caseId)}`);
        else caseOwners.set(caseId, suite.path);
      }
    }
    for (const call of suite.forbiddenCalls) report(5, suite.path, `forbidden call ${call}`);
    const owners = registry.features.filter((feature) => feature.suite?.path === suite.path);
    if (owners.length !== 1) report(2, suite.path, owners.length === 0 ? `orphan suite ${suite.path}; missing map entry` : `extra suite owners: ${owners.map((feature) => feature.path).join(", ")}`);
  }
  for (const path of registry.browserSpecs.filter((path) => !path.startsWith("studio/e2e/features/"))) {
    if (!registry.nonFeatureSpecs.some((spec) => spec.path === path)) report(9, path, `missing Non-feature browser specs row for ${path}`);
  }
  for (const spec of registry.nonFeatureSpecs) {
    if (!spec.reason.trim()) report(9, spec.path, `missing non-feature spec reason for ${spec.path}`);
    if (!existingPaths.has(spec.path)) report(9, spec.path, `missing listed non-feature spec ${spec.path}`);
    if (!registry.browserSpecs.includes(spec.path) || spec.path.startsWith("studio/e2e/features/")) report(9, spec.path, `extra non-feature spec listing ${spec.path}`);
  }
  return violations;
}
