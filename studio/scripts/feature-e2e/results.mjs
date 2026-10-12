import { resolve } from 'node:path';

const setupTitle = 'uses the provisioned model and completes first-run provider onboarding';
const tag = (value) => value.replace(/^@/, '');
const matchesFile = (actual, expected) => actual === expected || actual.replaceAll('\\', '/').endsWith(`/${expected}`);
function testsIn(suites, rootDir, inherited = {}) {
  return suites.flatMap((suite) => {
    const file = suite.file ?? inherited.file;
    const tags = [...(inherited.tags ?? []), ...(suite.tags ?? []), ...(suite.title?.match(/@(?:feature|case)-[^\s]+/g) ?? [])];
    return [...(suite.specs ?? []).flatMap((spec) => (spec.tests ?? []).map((test) => ({
      spec, test, file: rootDir ? resolve(rootDir, spec.file ?? file ?? '') : spec.file ?? file ?? '',
      tags: [...new Set([...tags, ...(spec.tags ?? []), ...(spec.title?.match(/@(?:feature|case)-[^\s]+/g) ?? [])].map(tag))],
    }))), ...testsIn(suite.suites ?? [], rootDir, { file, tags })];
  });
}
const firstPass = (test) => test.results?.length === 1 && test.results[0].status === 'passed' && (test.results[0].retry ?? 0) === 0 && test.status !== 'flaky';
const outcome = (test) => test.status === 'flaky' || test.results?.length > 1 || (test.results?.[0]?.retry ?? 0) > 0 ? 'flaky'
  : test.results?.at(-1)?.status === 'skipped' ? 'skipped' : firstPass(test) ? 'verified' : test.results?.length ? 'failing' : 'unrun';
const aggregate = (statuses) => ['failing', 'flaky', 'skipped', 'unrun'].find((status) => statuses.includes(status)) ?? (statuses.length ? 'verified' : 'unrun');

export function analyzeFeatureResults({ manifest, registry, reports }) {
  const problems = [];
  if (manifest.sourceChanged) problems.push('Revision inputs changed during browser execution');
  if (manifest.interrupted) problems.push('Browser execution was interrupted');
  if (manifest.violations?.length || manifest.driftViolations?.length) problems.push('Feature-suite drift-check violations');
  const selected = new Set(manifest.selection.caseIds);
  const featureIds = new Set(manifest.selection.featureIds);
  if (selected.size !== manifest.selection.caseIds.length) problems.push('Duplicate selected case identities');
  const cases = registry.features.flatMap((feature) => feature.cases.flatMap((item) => item.ids.map((id) => ({ id, featureId: feature.id, title: item.title, tags: item.tags, file: feature.suitePath, project: feature.profile === 'first-run' ? 'first-run' : 'chromium', status: 'unrun', attachments: [] }))));
  for (const id of selected) if (!cases.some((row) => row.id === id)) problems.push(`Unknown selected case: ${id}`);
  for (const id of featureIds) if (!registry.features.some((row) => row.id === id && row.suitePath)) problems.push(`Unknown or excluded selected feature: ${id}`);
  const totals = { passed: 0, failed: 0, skipped: 0, flaky: 0, tests: 0 };
  const invocations = new Map();
  for (const invocation of manifest.invocations) {
    const report = reports[invocation.id];
    const all = testsIn(report?.suites ?? [], report?.config?.rootDir);
    for (const { test } of all) {
      totals.tests++;
      const status = outcome(test);
      totals[status === 'verified' ? 'passed' : status === 'flaky' ? 'flaky' : status === 'skipped' ? 'skipped' : 'failed']++;
    }
    const setup = all.filter(({ test }) => test.projectName === 'setup');
    const setupPassed = invocation.project === 'first-run' ? setup.length === 0 : setup.length === 1 && setup[0].spec.title === setupTitle && matchesFile(setup[0].file, 'studio/e2e/onboarding.setup.ts') && firstPass(setup[0].test);
    const expected = cases.filter((row) => row.featureId === invocation.featureId && invocation.caseIds.includes(row.id));
    const identity = (entry, row) => entry.spec.title === row.title && matchesFile(entry.file, row.file) && entry.test.projectName === row.project && entry.tags.includes(`case-${row.id}`) && entry.tags.filter((value) => value.startsWith('case-')).length === 1 && entry.tags.includes(`feature-${row.featureId}`) && new Set(entry.tags.filter((value) => value.startsWith('feature-'))).size === 1;
    const unexpected = all.some((entry) => entry.test.projectName !== 'setup' && !expected.some((row) => identity(entry, row)));
    const unhealthy = !report || report.error || report.errors?.length || !invocation.cleanup?.clean || !setupPassed || unexpected || invocation.caseIds.some((id) => !selected.has(id));
    if (unhealthy || invocation.exitCode !== 0) problems.push(`${invocation.id}: missing report, unexpected identity, failed setup/execution or dirty cleanup`);
    // A nonzero exit is explained only by a failing feature case; otherwise it invalidates every pass in the report.
    const unexplainedExit = invocation.exitCode !== 0 && !all.some((entry) => entry.test.projectName !== 'setup' && outcome(entry.test) === 'failing');
    invocations.set(invocation, { all, identity, unhealthy, unexplainedExit });
  }
  for (const row of cases) {
    if (!selected.has(row.id)) continue;
    const owners = manifest.invocations.filter((item) => item.featureId === row.featureId && item.caseIds.includes(row.id));
    if (owners.length !== 1) {
      row.status = owners.length ? 'failing' : 'unrun';
      problems.push(`${row.id}: expected one invocation, got ${owners.length}`);
      continue;
    }
    const invocation = owners[0];
    row.invocation = invocation;
    const { all, identity, unhealthy, unexplainedExit } = invocations.get(invocation);
    const matching = all.filter((entry) => entry.tags.includes(`case-${row.id}`));
    const exact = matching.length === 1 && identity(matching[0], row) && invocation.project === row.project && matchesFile(invocation.file, row.file);
    row.attachments = matching.flatMap(({ test }) => (test.results ?? []).flatMap((result) => result.attachments ?? []));
    row.status = exact ? outcome(matching[0].test) : matching.length ? 'failing' : 'unrun';
    if (!exact) problems.push(`${row.id}: missing, duplicate or mismatched file/title/tag/feature/project identity`);
    if (unhealthy || (row.status === 'verified' && unexplainedExit)) row.status = 'failing';
    const executions = [...invocations.values()].flatMap((item) => item.all).filter((entry) => entry.tags.includes(`case-${row.id}`)).length;
    if (executions > 1) {
      row.status = 'failing';
      problems.push(`${row.id}: expected one execution across reports, got ${executions} executions`);
    }
  }
  // Edition-skipped work is reported as such, never as unrun or verified.
  const skipped = manifest.selection.skippedByEdition ?? { features: [], cases: [] };
  for (const row of cases) if (skipped.features.includes(row.featureId) || skipped.cases.includes(row.id)) row.status = 'not in edition';
  const features = registry.features.map((feature) => {
    const mapped = cases.filter((row) => row.featureId === feature.id);
    const status = feature.suite?.exclusion ? 'excluded' : skipped.features.includes(feature.id) ? 'not in edition'
      : aggregate(mapped.filter((row) => row.status !== 'not in edition').map((row) => row.status));
    const required = mapped.filter((row) => row.status !== 'not in edition').length;
    return { ...feature, required, passed: mapped.filter((row) => row.status === 'verified').length, status };
  });
  const selectedFeatures = features.filter((feature) => featureIds.has(feature.id));
  const successful = featureIds.size > 0 && selected.size > 0 && !problems.length && selectedFeatures.length === featureIds.size && selectedFeatures.every((feature) => feature.status === 'verified');
  return { verified: successful && manifest.selection.complete === true, successful, complete: manifest.selection.complete === true, totals, cases, features, problems };
}
