import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFeatures, planInvocations } from './selection.mjs';
import { parseFeatureSuite } from '../../src/test/feature-map/featureSuites.mjs';

const entry = (id, cases, options = {}) => ({ id, suitePath: `studio/e2e/features/${id}.spec.ts`, suite: { exclusion: null }, isolation: 'suite', profile: 'onboarded', cases: cases.map(([id, title]) => ({ ids: [id], tags: [`@case-${id}`], title })), ...options });
const registry = { features: [entry('welcome', [['welcome-start', 'Start welcome']], { profile: 'first-run' }), entry('planning', [['create-story', 'Create story'], ['move-story', 'Move story']], { isolation: 'case' }), entry('chrome', [['shell-open', 'Open shell']]), entry('native', [], { suitePath: null, suite: { exclusion: 'desktop-only' } })] };

test('full sweep preserves map order, omits exclusions and is complete', () => {
  const selected = selectFeatures(registry, []);
  assert.deepEqual(selected.features.map(feature => feature.id), ['welcome', 'planning', 'chrome']);
  assert.equal(selected.complete, true);
  assert.equal(selected.filtered, false);
  assert.deepEqual(selected.cases[0], { id: 'welcome-start', tag: '@case-welcome-start', title: 'Start welcome', featureId: 'welcome', file: 'studio/e2e/features/welcome.spec.ts', project: 'first-run' });
});

test('explicit feature lists keep sweep order and remain partial even when every feature is named', () => {
  const selected = selectFeatures(registry, ['chrome,welcome,planning']);
  assert.deepEqual(selected.features.map(feature => feature.id), ['welcome', 'planning', 'chrome']);
  assert.equal(selected.complete, false);
  assert.equal(selected.filtered, true);
  assert.deepEqual(selectFeatures(registry, ['--feature', 'chrome']).cases.map(item => item.id), ['shell-open']);
});

test('case filters select their owning features and intersect explicit feature selection', () => {
  const selected = selectFeatures(registry, ['--case', 'move-story,shell-open']);
  assert.deepEqual(selected.features.map(feature => feature.id), ['planning', 'chrome']);
  assert.deepEqual(selected.cases.map(item => item.id), ['move-story', 'shell-open']);
  assert.equal(selected.complete, false);
  assert.deepEqual(selectFeatures(registry, ['planning', '--case', 'move-story']).cases.map(item => item.id), ['move-story']);
});

test('grep matches title, project and feature/case tags in Playwright identity', () => {
  for (const grep of ['Move story', '@case-move-story', 'chromium.*planning.*@feature-planning.*Move story']) {
    const selected = selectFeatures(registry, ['--grep', grep]);
    assert.deepEqual(selected.cases.map(item => item.id), ['move-story']);
    assert.equal(selected.complete, false);
  }
  assert.deepEqual(selectFeatures(registry, ['--grep', 'first-run']).cases.map(item => item.id), ['welcome-start']);
});

test('invalid identifiers, options, exclusions and empty intersections fail clearly', () => {
  for (const [args, message] of [
    [['missing'], /Unknown feature: missing/],
    [['--case', 'missing'], /Unknown case: missing/],
    [['native'], /Excluded feature: native/],
    [['--wat'], /Unknown option: --wat/],
    [['--case'], /Missing value for --case/],
    [['chrome,'], /Empty feature identifier/],
    [['--case', ''], /Empty case identifier/],
    [['--grep', '['], /Invalid grep/],
    [['--grep', ''], /Empty grep/],
    [['chrome', '--case', 'move-story'], /Empty selection/],
    [['--grep', 'no-such-title'], /Empty selection/],
  ]) assert.throws(() => selectFeatures(registry, args), message);
  assert.throws(() => selectFeatures({ features: [] }, []), /Empty selection/);
  assert.throws(() => selectFeatures({ features: [entry('missing-suite', [['missing-case', 'Missing']], { suitePath: null })] }, []), /Missing suite.*missing-suite/);
});


test('suite isolation groups cases; case isolation gets one invocation each; first-run project is retained', () => {
  const invocations = planInvocations(selectFeatures(registry, []));
  assert.deepEqual(invocations.map(({ id, featureId, caseIds, project }) => ({ id, featureId, caseIds, project })), [
    { id: 'welcome', featureId: 'welcome', caseIds: ['welcome-start'], project: 'first-run' },
    { id: 'planning--create-story', featureId: 'planning', caseIds: ['create-story'], project: 'chromium' },
    { id: 'planning--move-story', featureId: 'planning', caseIds: ['move-story'], project: 'chromium' },
    { id: 'chrome', featureId: 'chrome', caseIds: ['shell-open'], project: 'chromium' },
  ]);
  const isolated = new RegExp(invocations[1].grep);
  assert.equal(isolated.test('chromium features/planning.spec.ts planning Create story @feature-planning @case-create-story'), true);
  assert.equal(isolated.test('chromium features/planning.spec.ts planning Create story @feature-planning @case-create-story-extra'), false);
});

test('suite invocation includes only selected exact tags and deduplicates repeated selections', () => {
  const suites = { features: [entry('stories', [['create', 'Create'], ['create-extra', 'Create extra'], ['delete', 'Delete']])] };
  const selected = selectFeatures(suites, ['stories,stories', '--case', 'create,delete,create']);
  const invocations = planInvocations(selected);
  assert.equal(invocations.length, 1);
  assert.deepEqual(invocations[0].caseIds, ['create', 'delete']);
  const grep = new RegExp(invocations[0].grep);
  assert.equal(grep.test('stories Create @case-create @feature-stories'), true);
  assert.equal(grep.test('stories Delete @case-delete'), true);
  assert.equal(grep.test('stories Create extra @case-create-extra'), false);
  assert.equal(selected.complete, false);
});


test('grep sees literal nested describe titles and all inherited detail tags', () => {
  const parsed = parseFeatureSuite(`featureSuite('stories', () => {
    test.describe('Nested journey', { tag: ['@nested', '@fast'] }, () => {
      test('Create story', { tag: ['@case-create', '@smoke'] }, () => {});
    });
  });`, 'studio/e2e/features/stories.spec.ts');
  const input = { features: [{ ...entry('stories', []), cases: parsed.cases }] };
  for (const pattern of ['Nested journey.*Create story', '@nested.*@fast.*@case-create.*@smoke', '^chromium features/stories\\.spec\\.ts stories @feature-stories Nested journey @nested @fast Create story @case-create @smoke$']) {
    assert.deepEqual(selectFeatures(input, ['--grep', pattern]).cases.map(item => item.id), ['create']);
  }
});

test('explicit selected features cannot silently disappear after a case or grep filter', () => {
  assert.throws(() => selectFeatures(registry, ['planning,chrome', '--case', 'move-story']), /No matching cases for selected feature: chrome/);
  assert.throws(() => selectFeatures(registry, ['planning,chrome', '--grep', 'Move story']), /No matching cases for selected feature: chrome/);
  assert.deepEqual(selectFeatures(registry, ['--case', 'move-story']).features.map(item => item.id), ['planning']);
});

test('duplicate registry identities fail before selection can collapse or misattribute cases', () => {
  const duplicateCases = { features: [entry('one', [['shared', 'First']]), entry('two', [['shared', 'Second']])] };
  assert.throws(() => selectFeatures(duplicateCases, ['one']), /Duplicate case identifier: shared/);
  const withinSuite = { features: [entry('one', [['shared', 'First'], ['shared', 'Second']])] };
  assert.throws(() => selectFeatures(withinSuite, []), /Duplicate case identifier: shared/);
  const duplicateFeatures = { features: [entry('one', [['first', 'First']]), entry('one', [['second', 'Second']])] };
  assert.throws(() => selectFeatures(duplicateFeatures, []), /Duplicate feature identifier: one/);
});

test('cases without exactly one case identity are reported as invalid metadata before planning', () => {
  const parsed = parseFeatureSuite(`featureSuite('broken', () => {
    test(observedTitle, async () => {});
    test('Doubled @case-one @case-two', async () => {});
  });`, 'studio/e2e/features/broken.spec.ts');
  const input = { features: [{ ...entry('broken', []), cases: parsed.cases }] };
  assert.throws(() => planInvocations(selectFeatures(input, [])), error => error instanceof Error && !(error instanceof TypeError)
    && /Invalid case metadata in studio\/e2e\/features\/broken\.spec\.ts: case <computed title> requires exactly one @case- tag; found none/.test(error.message)
    && /case 'Doubled @case-one @case-two' requires exactly one @case- tag; found @case-one, @case-two/.test(error.message));
});

const editionRegistry = { features: [
  entry('chrome', [['shell-open', 'Open shell'], ['sprint-tab', 'Sprint tab']], { editions: ['pocock', 'core'] }),
  entry('plan', [['plan-open', 'Open plan']], { editions: ['core'] }),
  entry('pocock-only', [['reviewed-defaults', 'Reviewed defaults']], { editions: ['pocock'] }),
] };
editionRegistry.features[0].cases[1].editionTags = ['@edition-core'];

test('Pocock skips core-only features and @edition-core cases and reports both', () => {
  const selected = selectFeatures(editionRegistry, [], { edition: 'pocock' });
  assert.equal(selected.edition, 'pocock');
  assert.deepEqual(selected.features.map(feature => feature.id), ['chrome', 'pocock-only']);
  assert.deepEqual(selected.cases.map(item => item.id), ['shell-open', 'reviewed-defaults']);
  assert.deepEqual(selected.skippedByEdition, { features: ['plan'], cases: ['sprint-tab'] });
  assert.equal(selected.complete, true);
  assert.deepEqual(planInvocations(selected).map(plan => plan.caseIds), [['shell-open'], ['reviewed-defaults']]);
});

test('core selects every core feature and case, skipping only features without core', () => {
  const selected = selectFeatures(editionRegistry, [], { edition: 'core' });
  assert.deepEqual(selected.features.map(feature => feature.id), ['chrome', 'plan']);
  assert.deepEqual(selected.cases.map(item => item.id), ['shell-open', 'sprint-tab', 'plan-open']);
  assert.deepEqual(selected.skippedByEdition, { features: ['pocock-only'], cases: [] });
});

test('the default edition is Pocock', () => {
  assert.deepEqual(selectFeatures(editionRegistry, []).skippedByEdition, { features: ['plan'], cases: ['sprint-tab'] });
});

test('explicitly selecting a feature or case outside the edition names the edition to rerun with', () => {
  assert.throws(() => selectFeatures(editionRegistry, ['plan'], { edition: 'pocock' }), /Feature plan is not in the pocock edition \(Editions: core\); rerun with TICKETRY_EDITION=core/);
  assert.throws(() => selectFeatures(editionRegistry, ['--case', 'sprint-tab'], { edition: 'pocock' }), /Case sprint-tab is tagged @edition-core and does not run in the pocock edition; rerun with TICKETRY_EDITION=core/);
  assert.throws(() => selectFeatures(editionRegistry, ['pocock-only'], { edition: 'core' }), /Feature pocock-only is not in the core edition \(Editions: pocock\); rerun with TICKETRY_EDITION=pocock/);
});

test('an explicit selection reports the edition-skipped cases of its own features only', () => {
  const selected = selectFeatures(editionRegistry, ['chrome'], { edition: 'pocock' });
  assert.deepEqual(selected.cases.map(item => item.id), ['shell-open']);
  assert.deepEqual(selected.skippedByEdition, { features: [], cases: ['sprint-tab'] });
});
