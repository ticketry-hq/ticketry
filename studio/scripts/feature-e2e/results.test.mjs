import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFeatureResults } from './results.mjs';
const feature = { id: 'pilot', suitePath: 'studio/e2e/features/pilot.spec.ts', profile: 'onboarded', cases: [{ title: 'Works', tags: ['@case-works'], ids: ['works'] }] };
const setup = { title: 'uses the provisioned model and completes first-run provider onboarding', file: 'studio/e2e/onboarding.setup.ts', tests: [{ projectName: 'setup', results: [{ status: 'passed', retry: 0 }] }] };
const spec = { title: 'Works', tags: ['@case-works'], tests: [{ projectName: 'chromium', results: [{ status: 'passed', retry: 0 }] }] };
export const fixture = () => ({ registry: { features: [structuredClone(feature)] }, manifest: { selection: { featureIds: ['pilot'], caseIds: ['works'], complete: true }, invocations: [{ id: 'pilot', featureId: 'pilot', caseIds: ['works'], project: 'chromium', file: feature.suitePath, exitCode: 0, cleanup: { clean: true } }] }, reports: { pilot: { suites: [{ specs: [structuredClone(setup)] }, { file: feature.suitePath, tags: ['@feature-pilot'], suites: [{ specs: [structuredClone(spec)] }] }] } } });
test('one exact first-attempt case and onboarding verify the selected feature', () => {
  const result = analyzeFeatureResults(fixture());
  assert.equal(result.verified, true);
  assert.equal(result.features[0].status, 'verified');
  assert.equal(result.cases[0].status, 'verified');
});

test('passing filtered selections never establish complete coverage', () => {
  const input = fixture(); input.manifest.selection.complete = false;
  const result = analyzeFeatureResults(input);
  assert.equal(result.verified, false);
  assert.equal(result.successful, true);
});

test('mismatched titles, tags, feature, project and file cannot verify', () => {
  for (const mutate of [
    (entry) => { entry.title = 'Other'; },
    (entry) => { entry.tags = ['@case-other']; },
    (entry, report) => { report.suites[1].tags = ['@feature-other']; },
    (entry) => { entry.tests[0].projectName = 'other'; },
    (entry, report) => { report.suites[1].file = 'studio/e2e/features/other.spec.ts'; },
  ]) {
    const input = fixture(); const report = input.reports.pilot;
    mutate(report.suites[1].suites[0].specs[0], report);
    assert.equal(analyzeFeatureResults(input).verified, false);
  }
});

test('duplicate invocations and duplicate executions fail identity checks', () => {
  const input = fixture(); input.manifest.invocations.push(structuredClone(input.manifest.invocations[0]));
  assert.equal(analyzeFeatureResults(input).cases[0].status, 'failing');
  const other = fixture(); other.reports.pilot.suites[1].suites[0].specs.push(structuredClone(spec));
  assert.equal(analyzeFeatureResults(other).cases[0].status, 'failing');
});

test('flaky, skipped and unrun cases retain distinct outcomes', () => {
  for (const [results, expected] of [[[{ status: 'failed' }, { status: 'passed', retry: 1 }], 'flaky'], [[{ status: 'passed', retry: 1 }], 'flaky'], [[{ status: 'skipped' }], 'skipped'], [[], 'unrun']]) {
    const input = fixture(); input.reports.pilot.suites[1].suites[0].specs[0].tests[0].results = results;
    assert.equal(analyzeFeatureResults(input).cases[0].status, expected);
  }
  const input = fixture(); input.manifest.invocations = [];
  assert.equal(analyzeFeatureResults(input).cases[0].status, 'unrun');
});

test('missing, failed, duplicate or retried onboarding and dirty cleanup fail the feature', () => {
  for (const mutate of [
    (input) => { input.reports.pilot.suites.shift(); },
    (input) => { input.reports.pilot.suites[0].specs[0].tests[0].results[0].status = 'failed'; },
    (input) => { input.reports.pilot.suites[0].specs.push(structuredClone(setup)); },
    (input) => { input.reports.pilot.suites[0].specs[0].tests[0].results[0].retry = 1; },
    (input) => { input.manifest.invocations[0].cleanup.clean = false; },
  ]) {
    const input = fixture(); mutate(input);
    assert.equal(analyzeFeatureResults(input).features[0].status, 'failing');
  }
});

test('first-run suites verify without an onboarding dependency', () => {
  const input = fixture(); input.registry.features[0].profile = 'first-run';
  input.manifest.invocations[0].project = 'first-run'; input.reports.pilot.suites.shift();
  input.reports.pilot.suites[0].suites[0].specs[0].tests[0].projectName = 'first-run';
  assert.equal(analyzeFeatureResults(input).verified, true);
});

test('source changes, interruptions, drift and empty selections fail overall evidence', () => {
  for (const extra of [{ sourceChanged: true }, { interrupted: true }, { violations: [{ message: 'drift' }] }, { selection: { featureIds: [], caseIds: [], complete: true } }]) {
    const input = fixture(); Object.assign(input.manifest, extra);
    assert.equal(analyzeFeatureResults(input).verified, false);
  }
});

test('Playwright rootDir resolution accepts exact sources and rejects another tree', () => {
  const input = fixture(); input.reports.pilot.config = { rootDir: '/fixture/studio/e2e' };
  input.reports.pilot.suites[0].specs[0].file = 'onboarding.setup.ts';
  input.reports.pilot.suites[1].file = 'features/pilot.spec.ts';
  assert.equal(analyzeFeatureResults(input).verified, true);
  input.reports.pilot.config.rootDir = '/fixture/other/e2e';
  assert.equal(analyzeFeatureResults(input).verified, false);
});

test('title tags duplicated by Playwright tags count as one identity', () => {
  const input = fixture(); input.registry.features[0].cases[0].title = 'Works @case-works';
  input.reports.pilot.suites[1].suites[0].specs[0].title = 'Works @case-works';
  assert.equal(analyzeFeatureResults(input).verified, true);
});

test('nonzero Playwright exit preserves skipped and flaky case outcomes', () => {
  for (const [results, expected] of [[[{ status: 'skipped' }], 'skipped'], [[{ status: 'failed' }, { status: 'passed' }], 'flaky']]) {
    const input = fixture(); input.manifest.invocations[0].exitCode = 1;
    input.reports.pilot.suites[1].suites[0].specs[0].tests[0].results = results;
    assert.equal(analyzeFeatureResults(input).cases[0].status, expected);
    assert.equal(analyzeFeatureResults(input).verified, false);
  }
});

test('a case executed again in another invocation cannot remain verified', () => {
  const input = fixture();
  input.registry.features[0].cases.push({ ids: ['other'], tags: ['@case-other'], title: 'Other' });
  input.manifest.selection.caseIds.push('other');
  input.manifest.invocations.push({ ...structuredClone(input.manifest.invocations[0]), id: 'other', caseIds: ['other'] });
  input.reports.other = structuredClone(input.reports.pilot);
  const extra = structuredClone(input.reports.other.suites[1].suites[0].specs[0]);
  extra.title = 'Other'; extra.tags = ['@case-other'];
  input.reports.other.suites[1].suites[0].specs.push(extra);
  const result = analyzeFeatureResults(input);
  assert.equal(result.cases.find((row) => row.id === 'works').status, 'failing');
  assert(result.problems.some((problem) => problem.includes('works') && problem.includes('executions')));
});

const mixedSuite = () => {
  const input = fixture();
  input.registry.features[0].cases.push({ ids: ['broken'], tags: ['@case-broken'], title: 'Broken' }, { ids: ['peer'], tags: ['@case-peer'], title: 'Peer' });
  input.manifest.selection.caseIds.push('broken', 'peer');
  input.manifest.invocations[0].caseIds.push('broken', 'peer');
  input.manifest.invocations[0].exitCode = 1;
  const specs = input.reports.pilot.suites[1].suites[0].specs;
  specs.push({ title: 'Broken', tags: ['@case-broken'], tests: [{ projectName: 'chromium', results: [{ status: 'failed', retry: 0 }] }] });
  specs.push({ title: 'Peer', tags: ['@case-peer'], tests: [{ projectName: 'chromium', results: [{ status: 'passed', retry: 0 }] }] });
  return input;
};

test('a failing case keeps the run failed without discarding its passing siblings', () => {
  const result = analyzeFeatureResults(mixedSuite());
  const status = Object.fromEntries(result.cases.map((row) => [row.id, row.status]));
  assert.deepEqual(status, { works: 'verified', broken: 'failing', peer: 'verified' });
  assert.equal(result.features[0].status, 'failing');
  assert.equal(result.features[0].passed, 2);
  assert.equal(result.successful, false);
  assert.equal(result.verified, false);
  assert(result.problems.length > 0);
});

test('a nonzero exit with no failing case still invalidates first-attempt passes', () => {
  const input = fixture(); input.manifest.invocations[0].exitCode = 1;
  const result = analyzeFeatureResults(input);
  assert.equal(result.cases[0].status, 'failing');
  assert.equal(result.verified, false);
});

test('setup, cleanup, report errors and identity faults still invalidate passing siblings', () => {
  for (const mutate of [
    (input) => { input.reports.pilot.suites[0].specs[0].tests[0].results[0].status = 'failed'; },
    (input) => { input.manifest.invocations[0].cleanup.clean = false; },
    (input) => { input.reports.pilot.errors = [{ message: 'global teardown failed' }]; },
    (input) => { input.reports.pilot.suites[1].suites[0].specs.push({ title: 'Stray', tags: ['@case-stray'], tests: [{ projectName: 'chromium', results: [{ status: 'passed', retry: 0 }] }] }); },
  ]) {
    const input = mixedSuite(); mutate(input);
    const result = analyzeFeatureResults(input);
    assert.deepEqual(result.cases.map((row) => row.status), ['failing', 'failing', 'failing']);
  }
});
