import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeFeatureResults } from './report.mjs';

test('report renders every coverage outcome and records browser gaps without overwriting prior evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'feature-evidence-'));
  try {
    const registry = { features: [{ id: 'pilot', suitePath: 'studio/e2e/features/pilot.spec.ts', cases: [{ ids: ['works'], tags: ['@case-works'], title: 'Works' }], coverage: { columns: ['Sub-feature', 'Success', 'Cancel', 'Error', 'Empty', 'Entry points', 'Persistence'], rows: [{ id: 'pilot-action', cells: ['@case-works', 'n/a: no cancellation', 'manual: force failure', 'desktop-only: native view', '@case-works', '@case-works'] }] } }, { id: 'native', suite: { exclusion: 'desktop-only', reason: 'native renderer' }, cases: [] }] };
    const execute = (id) => {
      const runDirectory = join(root, '.ticketry-dev/e2e-results', id);
      const artifactDirectory = join(runDirectory, 'pilot'); mkdirSync(join(artifactDirectory, 'artifacts'), { recursive: true });
      writeFileSync(join(artifactDirectory, 'artifacts', 'trace.zip'), 'trace');
      writeFileSync(join(artifactDirectory, 'artifacts', 'screen.png'), 'screen');
      writeFileSync(join(artifactDirectory, 'cleanup.json'), '{}');
      writeFileSync(join(artifactDirectory, 'results.json'), JSON.stringify({ suites: [] }));
      const manifest = { runId: id, revision: 'revision', selection: { featureIds: ['pilot'], caseIds: ['works'], complete: false }, invocations: [{ id: 'pilot', featureId: 'pilot', caseIds: ['works'], file: registry.features[0].suitePath, project: 'chromium', artifactDirectory, exitCode: 0, cleanup: { clean: true } }] };
      const result = writeFeatureResults({ runDirectory, manifest, registry, repositoryRoot: root });
      assert.equal(result.verified, false);
      return join(runDirectory, 'summary.md');
    };
    const first = execute('first'); const original = readFileSync(first, 'utf8');
    assert.match(original, /@case-works.*failing/);
    assert.match(original, /Not verified by the browser/);
    assert.match(original, /pilot-action.*Error.*manual: force failure/);
    assert.match(original, /pilot-action.*Empty.*desktop-only: native view/);
    assert.match(original, /native.*native renderer/);
    assert.match(original, /\[trace\]\(pilot\/artifacts\/trace.zip\)/);
    assert.match(original, /\[cleanup\]\(pilot\/cleanup.json\)/);
    execute('second');
    assert.equal(readFileSync(first, 'utf8'), original);
    assert.match(readFileSync(join(root, '.ticketry-dev/e2e-results/latest.md'), 'utf8'), /second\/summary.md/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
