import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlaywrightCommand } from './run-feature-e2e.mjs';
test('feature invocation forces first-attempt trace evidence in its expected project', () => {
  assert.deepEqual(buildPlaywrightCommand({file:'studio/e2e/features/pilot.spec.ts', project:'first-run', grep:'@case-pilot'}), ['bun','run','--cwd','studio','test:e2e','e2e/features/pilot.spec.ts','--project','first-run','--grep','@case-pilot','--trace','on','--retries','0']);
});
