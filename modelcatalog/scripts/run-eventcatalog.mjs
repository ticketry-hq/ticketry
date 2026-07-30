import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const catalogRoot = resolve(import.meta.dirname, '..');
const localConfigRoot = resolve(catalogRoot, '.eventcatalog-core');
const sharedNodeModules = resolve(catalogRoot, '..', 'eventcatalog', 'node_modules');
const localNodeModules = resolve(catalogRoot, 'node_modules');
const command = resolve(
  sharedNodeModules,
  '.bin',
  process.platform === 'win32' ? 'eventcatalog.cmd' : 'eventcatalog',
);

mkdirSync(localConfigRoot, { recursive: true });
if (!existsSync(localNodeModules)) {
  symlinkSync(sharedNodeModules, localNodeModules, 'dir');
}

const result = spawnSync(command, process.argv.slice(2), {
  cwd: catalogRoot,
  env: {
    ...process.env,
    ASTRO_TELEMETRY_DISABLED: '1',
    NO_UPDATE_NOTIFIER: '1',
    XDG_CONFIG_HOME: localConfigRoot,
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
