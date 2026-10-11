import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFeatureCommand } from './feature-e2e-command.mjs';

test('list JSON exposes the derived feature identities and cases', () => {
  const lines = [];
  const feature = { id: 'onboarding', suitePath: 'studio/e2e/features/onboarding.spec.ts', isolation: 'suite', profile: 'first-run', cases: [{ ids: ['welcome'], title: 'welcome' }] };
  const code = runFeatureCommand(['--list', '--json'], { registry: { features: [feature] }, violations: [], write: (line) => lines.push(line) });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(lines.join('\n')), [{ id: 'onboarding', suitePath: 'studio/e2e/features/onboarding.spec.ts', isolation: 'suite', profile: 'first-run', cases: ['welcome'] }]);
});

test('check prints all disagreements and returns failure', () => {
  const lines = [];
  const code = runFeatureCommand(['--check'], { registry: { features: [] }, violations: [{ rule: 1, path: 'welcome.md', message: 'welcome.md: rule 1: missing Suite line' }, { rule: 9, path: 'old.spec.ts', message: 'old.spec.ts: rule 9: unlisted spec' }], write: line => lines.push(line) });
  assert.equal(code, 1);
  assert.deepEqual(lines, ['welcome.md: rule 1: missing Suite line', 'old.spec.ts: rule 9: unlisted spec']);
});
