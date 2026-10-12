// Provider-catalog module exception registry.
//
// Rule admission policy: a reuse rule blocks only when its violation is
// objectively detectable and a Supported-now replacement exists. Here the
// replacement is one versioned entry in catalog_registry.rs, so any other
// module in the provider-catalog migrations folder blocks unless it is listed
// below with the reason it cannot be expressed as a registry entry. An entry
// whose file no longer exists also blocks, so this list cannot drift.
//
// Candidate future rules. They are not implemented here and may block only
// once their replacement is Supported now:
// - typed MCP handlers (CODING-2726);
// - generated frontend contracts (CODING-2727);
// - mutation cache effects (CODING-2728). Its replacement, the shared
//   declared-mutation module (studio/src/shared/apollo/declaredMutation/), is
//   now Supported now; no blocking rule has been added yet;
// - settings editor workflows (CODING-2729).
import { providerCatalogMigrationsFolder } from "./rules/provider-catalog-modules.mjs";

export const providerCatalogModuleExceptions = [
  {
    file: `${providerCatalogMigrationsFolder}/codex_6_astra.rs`,
    reason: "Renames a model while keeping its row id, which a catalog registry entry cannot express.",
  },
];
