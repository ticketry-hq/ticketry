import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const catalogRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(catalogRoot, '..', '..');
const backendRoot = resolve(repositoryRoot, 'backend');
const destination = resolve(
  catalogRoot,
  'domains/desktop-runtime/systems/desktop-application/services/ticketry-backend/openapi.json',
);
const localPython =
  process.platform === 'win32'
    ? resolve(backendRoot, '.venv', 'Scripts', 'python.exe')
    : resolve(backendRoot, '.venv', 'bin', 'python');
const python = process.env.TICKETRY_PYTHON || (existsSync(localPython) ? localPython : 'python3');
const exporter = resolve(repositoryRoot, 'scripts/export-openapi.mjs');

mkdirSync(dirname(destination), { recursive: true });
mkdirSync(resolve(catalogRoot, '.eventcatalog-core'), { recursive: true });

const result = spawnSync(process.execPath, [exporter], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    WORKTRACKER_PYTHON: python,
    WORKTRACKER_OPENAPI_DESTINATION: destination,
    MUXED_DATA_DIR: resolve(catalogRoot, '.eventcatalog-core'),
    MUXED_STATE_DB: resolve(catalogRoot, '.eventcatalog-core', 'catalog-state.db'),
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`Synced Ticketry OpenAPI to ${destination}`);
