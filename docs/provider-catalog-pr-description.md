## Summary

Provider model changes now use one versioned settings registry entry. Startup
and ledger classification discover entries through the generic catalog contract;
the seven per-model installers and fourteen per-model constants are removed from
the settings public API and its fixture.

```diff
 Next provider model
- copied transaction/ledger wrapper + per-model wiring across settings and installation
+ one new versioned entry in catalog_registry.rs + expected-catalog test updates
```

Historical ids, ledger names, source commits, version, chain positions and startup
error labels remain fixed. The in-place Astra rename stays a private handler.
The new [settings feature map](feature-map/settings.md) explains the entry,
reasoning-update, chain-number and test workflows.

## Evidence

- **Before:** the next model required seven handwritten touch points:
  1. A new settings `provider_catalog_migrations/codex_X.rs` transaction/ledger wrapper.
  2. Settings `provider_catalog_migrations/mod.rs` module and per-model export wiring.
  3. Settings `src/lib.rs` installer, ledger and migration-id re-exports.
  4. `studio/src-tauri/tests/fixtures/public-api.txt` entries for those exports.
  5. Installation `final_schema_migrations.rs` import, ordered migration id and installer call.
  6. Installation `classification/rust_ledger.rs::owned_ledgers()` ledger declaration.
  7. Expected catalog in `tests/final_schema_migration_chain/support.rs` and `tests/installation_adoption.rs`.

  **After:** declare and register one new versioned entry in settings
  `provider_catalog_migrations/catalog_registry.rs`, then update expected-catalog
  tests. The generic runner, crate exports, public-API fixture, installation chain
  and ledger classification need no model-specific wiring. Reasoning changes
  append an entry naming the existing model and its full new reasoning list;
  historical entries remain immutable.

- **Intentional compatibility correction:** step `0057` now checks for the
  reasoning-join table that GLM Flash reconciliation already deletes from. An
  incomplete schema defers without a ledger and retries after the table exists;
  previously that join delete failed. No user-visible behavior change is expected.
- **Contract proof:** removing the 21 fixture entries first made
  `library_roots_are_the_only_public_facades` fail; removing the exports then
  passed the same test. No per-model symbols remain in Rust.
- **Gate maintenance:** existing planning convergence was missing from five
  status-stream assertions and the description rollback wire journal. Their
  focused suites now pass with test-only expectation updates. The first lazy
  workflow-guide modal open now waits up to four seconds under suite load.
  The numbered gate includes the existing overhaul-466 case. Production UI is
  unchanged.
- **Validation:** focused Rust integration suites passed (72 tests), settings
  passed (39 unit + 4 integration), typecheck and Studio build passed. The
  numbered overhaul passed (181 files, 684 tests), including all three provider
  catalog runtime cases. The sprint-chain test passed and all four installation final-schema unit
  tests passed. Full Studio passed (315 files, 1,329 tests), and the final
  numbered overhaul passed (181 files, 684 tests).
- **Additional sweep limitation:** the wider installation unit suite passed
  89/90; unchanged `import::canonical::tests::canonicalizes_every_cross_engine_type`
  fails on JSON key ordering (`b,a` versus `a,b`). This import-code failure is
  outside the catalog change; all required catalog/chain suites pass.

## Merge Danger

**Door:** two-way

The historical ledger format/version and migration identities remain compatible;
rollback does not require rewriting installed data. Removing per-model exports
is an intentional source API change for callers, which now use the generic seam.

**Blast Radius:** startup

Catalog migration and installation classification are affected. The gate results
must establish fresh-install, upgrade, reopen, rollback and runtime-picker coverage.
