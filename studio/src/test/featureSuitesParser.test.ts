import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveFeatureRegistry, parseFeatureSuite } from './feature-map/featureSuites.mjs';

describe('feature suite source contract', () => {
  it('derives literal case identity through nested describes and extended fixtures', () => {
    const suite = parseFeatureSuite(`featureSuite('planning', { test: healthTest, isolation: 'case', profile: 'first-run' }, () => {
      healthTest.describe('nested', () => { healthTest('creates story', { tag: '@case-create-story' }, async () => {}); });
    });`, 'studio/e2e/features/planning.spec.ts');
    expect(suite.declarations).toEqual([{ id: 'planning', isolation: 'case', profile: 'first-run', topLevel: true }]);
    expect(suite.cases).toEqual([{ title: 'creates story', titlePath: ['planning', 'nested', 'creates story'], allTags: ['@feature-planning', '@case-create-story'], grepTitlePath: ['planning', '@feature-planning', 'nested', 'creates story', '@case-create-story'], tags: ['@case-create-story'], ids: ['create-story'], literalTitle: true, literalTags: true, insideDeclaration: true }]);
    expect(suite.violations).toEqual([]);
  });
});

it('derives coverage citations and map identifiers from disposable sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'feature-parser-'));
  try {
    const map = join(root, 'docs/feature-map'), e2e = join(root, 'studio/e2e');
    mkdirSync(map, { recursive: true }); mkdirSync(join(e2e, 'features'), { recursive: true });
    writeFileSync(join(map, 'README.md'), '# Map\n\n[Planning](planning.md)\n\n## Non-feature browser specs\n\n| Spec | Reason |\n| --- | --- |\n| `studio/e2e/contracts.spec.ts` | Public contract |\n| missing.spec.ts | Missing path |');
    writeFileSync(join(map, 'planning.md'), '# Planning\n\n## Sub-features\n\n- `story-create`: Create.\n\n## End-to-end suite\n\nSuite: studio/e2e/features/planning.spec.ts\n\n| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |\n| --- | --- | --- | --- | --- | --- | --- |\n| story-create | @case-create | n/a: none | manual: inspect @case-reason | desktop-only: native | @case-create | @case-create |');
    writeFileSync(join(e2e, 'features/planning.spec.ts'), "featureSuite('planning', () => { test('create @case-create', () => {}); });");
    const registry = deriveFeatureRegistry(map, e2e, root);
    expect(registry.features[0]).toMatchObject({ id: 'planning', suitePath: 'studio/e2e/features/planning.spec.ts', isolation: 'suite', profile: 'onboarded', subFeatures: ['story-create'] });
    expect(registry.features[0].coverage.rows[0]).toMatchObject({ id: 'story-create' });
    expect(registry.features[0].cellCitations).toContainEqual({ subFeature: 'story-create', dimension: 'Success', ids: ['create'] });
    expect(registry.features[0].cellCitations.find((cell) => cell.dimension === 'Error')?.ids).toEqual([]);
    expect(registry.nonFeatureSpecs).toEqual([{ path: 'studio/e2e/contracts.spec.ts', reason: 'Public contract' }, { path: 'missing.spec.ts', reason: 'Missing path' }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('rejects computed titles, tag shorthand, and metadata shorthand without guessing', () => {
  const suite = parseFeatureSuite(`featureSuite(featureId, { profile, isolation: mode }, () => {
    test(title, { tag }, () => {});
    test('fixed', { tag: ['@case-fixed', dynamicTag] }, () => {});
  });`, 'features/computed.spec.ts');
  expect(suite.violations.map((item) => item.rule)).toEqual([3, 3, 3, 4, 4, 4]);
  expect(suite.cases[0]).toMatchObject({ title: null, literalTags: false });
});

it('reads imported aliases, outside cases, and every forbidden test call', () => {
  const suite = parseFeatureSuite(`import { test as check } from './fixture';
    check('outside @case-outside', () => {});
    featureSuite('planning', () => {
      check.describe.only('nested', () => { check.only('focused @case-focused', () => {}); });
      check('inside @case-inside', () => { check.skip(condition, 'reason'); check.fixme(); });
    });`, 'features/planning.spec.ts');
  expect(suite.cases.map((item) => [item.ids, item.insideDeclaration])).toEqual([[['outside'], false], [['focused'], true], [['inside'], true]]);
  expect(suite.forbiddenCalls).toEqual(['check.describe.only', 'check.only', 'check.skip', 'check.fixme']);
});

it('accepts the test fixture shorthand without treating it as suite metadata', () => {
  const suite = parseFeatureSuite(`featureSuite('planning', { test }, () => { test('case @case-fixed', () => {}); });`, 'features/planning.spec.ts');
  expect(suite.violations).toEqual([]);
});

it('derives cases only from Playwright test bindings, not other .test methods', () => {
  const suite = parseFeatureSuite(`import { test as check } from '@playwright/test';
    featureSuite('example', { test: healthTest }, () => {
      test('plain', { tag: '@case-plain' }, async () => {
        /launch/.test('observed request');
        const observed = request.url();
        pattern.test(observed);
        new RegExp('x').test(observed);
        getMatcher().test(observed);
        (matcher).test(observed);
        this.test(observed);
        matchers[0].test(observed);
      });
      check('aliased', { tag: '@case-aliased' }, async () => {});
      healthTest('extended', { tag: '@case-extended' }, async () => {});
    });`, 'example.spec.ts');
  expect(suite.cases.map((item) => [item.title, item.ids])).toEqual([['plain', ['plain']], ['aliased', ['aliased']], ['extended', ['extended']]]);
  expect(suite.forbiddenCalls).toEqual([]);
  expect(suite.violations).toEqual([]);
});

it('derives exactly one case for the RegExp.test reproduction', () => {
  const suite = parseFeatureSuite(`featureSuite("example", () => { test("case", { tag: "@case-example" }, async () => { /launch/.test("observed request"); }); });`, 'example.spec.ts');
  expect(suite.cases.map((item) => [item.title, item.ids])).toEqual([['case', ['example']]]);
});
