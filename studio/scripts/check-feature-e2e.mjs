import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { deriveFeatureRegistry } from '../src/test/feature-map/featureSuites.mjs';
import { checkFeatureSuites } from '../src/test/feature-map/checkFeatureSuites.mjs';
import { runFeatureCommand } from './feature-e2e-command.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const map = resolve(root, 'docs/feature-map');
const e2e = resolve(root, 'studio/e2e');
process.exitCode = runFeatureCommand(process.argv.slice(2), {
  registry: deriveFeatureRegistry(map, e2e, root),
  violations: checkFeatureSuites(map, e2e, root),
});
