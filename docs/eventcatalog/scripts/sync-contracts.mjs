import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
const exporter = [
  'import json',
  'import django',
  'django.setup()',
  'from studio_server.api import api',
  'print(json.dumps(api.get_openapi_schema(), indent=2, sort_keys=True, ensure_ascii=False))',
].join('; ');

mkdirSync(dirname(destination), { recursive: true });
mkdirSync(resolve(catalogRoot, '.eventcatalog-core'), { recursive: true });

const result = spawnSync(python, ['-c', exporter], {
  cwd: backendRoot,
  env: {
    ...process.env,
    DJANGO_SETTINGS_MODULE: 'studio_server.settings',
    MUXED_DATA_DIR: resolve(catalogRoot, '.eventcatalog-core'),
    MUXED_STATE_DB: resolve(catalogRoot, '.eventcatalog-core', 'catalog-state.db'),
  },
  encoding: 'utf8',
});

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

writeFileSync(destination, `${result.stdout.trim()}\n`, 'utf8');
console.log(`Synced Ticketry OpenAPI to ${destination}`);
