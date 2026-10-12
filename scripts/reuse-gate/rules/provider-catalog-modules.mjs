import path from "node:path";

export const providerCatalogMigrationsFolder =
  "studio/src-tauri/crates/config/ticketry-settings/src/provider_catalog_migrations";
const exceptionRegistry = "scripts/reuse-gate/provider-catalog-exceptions.mjs";
const registryHowTo = "docs/feature-map/settings.md#add-a-model-or-change-its-reasoning-levels";

// catalog_* modules and everything under catalog_* folders, *_tests modules,
// the ledger and mod.rs are the approved shape of the folder.
function isApprovedModule(file) {
  const [first, ...nested] = path.posix.relative(providerCatalogMigrationsFolder, file).split("/");
  if (first.startsWith("catalog_")) return true;
  if (nested.length > 0) return false;
  const module = path.posix.basename(first, ".rs");
  return module === "ledger" || module === "mod" || module.endsWith("_tests");
}

// A provider model or reasoning-level change is one entry in catalog_registry.rs,
// never a new per-model migration module in the provider-catalog folder.
export function providerCatalogModuleFindings({
  providerCatalogMigrationFiles = [],
  providerCatalogModuleExceptions = [],
  readRepositoryFile,
}) {
  const excepted = new Set(providerCatalogModuleExceptions.map(({ file }) => file));
  const blocking = providerCatalogMigrationFiles
    .filter((file) => !isApprovedModule(file) && !excepted.has(file))
    .map((file) => ({
      id: "provider-catalog/per-model-module",
      file,
      message: `add a catalog registry entry instead of a per-model module; see ${registryHowTo}`,
    }));
  const stale = providerCatalogModuleExceptions
    .filter(({ file }) => readRepositoryFile(file) === null)
    .map(({ file }) => ({
      id: "provider-catalog/stale-exception",
      file,
      message: `this file no longer exists; remove its entry from ${exceptionRegistry}`,
    }));
  return { blocking: [...blocking, ...stale] };
}
