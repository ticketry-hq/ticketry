import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const catalogRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(catalogRoot, '..', '..');
const contract = resolve(repositoryRoot, 'openapi.json');
const destination = resolve(
  catalogRoot,
  'domains/desktop-runtime/systems/desktop-application/services/ticketry-backend/openapi.json',
);
mkdirSync(dirname(destination), { recursive: true });
mkdirSync(resolve(catalogRoot, '.eventcatalog-core'), { recursive: true });

const schema = JSON.parse(readFileSync(contract, 'utf8'));
writeFileSync(destination, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
console.log(`Synced Ticketry OpenAPI to ${destination}`);
