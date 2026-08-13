# CODING-583 Slice 2 ownership handoff

## Ownership closure

The checked manifest is
`studio/src-tauri/src/settings_persistence/ownership_manifest.rs`. Rust is the
only production writer for:

* `app_settings`;
* `worktracker_provider`, `worktracker_agentmodel`, and
  `worktracker_reasoninglevel`;
* the `worktracker_agentmodelreasoninglevel` compatibility join;
* `worktracker_launchbinding`, including prompt, required skills, model,
  reasoning, auto-start, and subtree-run policy; and
* `profiles.json` and `features.json`.

Packaged startup sets `TICKETRY_RUST_SLICE2_OWNER=1`. Django then returns
`410 django_slice2_write_disabled` for the legacy settings/config/catalogue
mutation routes. Non-HTTP profile and AppSetting writers carry the same guard.
The live launch-binding seed is guarded while historical migration models may
still provision a brand-new database before ownership is installed. No signal
or provider adapter writes a transferred resource.

Django keeps two narrow roles: `apps.settings_store.compatibility` reads a
fresh profile snapshot for Python-owned filesystem/terminal effects, and
`apps.execution.launch_policy_port` idempotently performs an immutable launch
decision authored by Rust. Neither port resolves or persists policy.

## Startup and readiness

While holding the installation lease, startup performs a read-only Slice 2
preflight before installing either ownership ledger. It rejects unsafe paths,
unknown migrations/table shapes, integrity failures, malformed JSON, adapter
catalogue drift, empty identities/timestamps, cross-project launch bindings,
and incompatible model/reasoning relationships.

For a supported Django source it then truncates the SQLite WAL, rotates private
database/profile/feature snapshots, hashes and reopens each present snapshot,
checks exact row counts and semantic digests, installs the idempotent ownership
ledger, and rechecks the counts and digest in the transaction. Restart sees the
known ledger and validates the current resources without creating a new
snapshot.

The desktop publishes `slice2-readiness.json` only after all of these are true:

1. database and asset ownership is validated;
2. the installed GraphQL endpoint answers a real query;
3. the Rust MCP listener answers `tools/list` with its checked registry; and
4. the Django effect port reports version 1 with Rust policy ownership and no
   Django write fallback.

The Studio service-health gate remains closed until that single result is
published. MCP refuses to bind if the effect-port result is absent or partial.
The shipping GraphQL schema rejects mutations until the exact complete result
is present, and the Django compatibility endpoint independently rejects effect
commands while that same result is missing, malformed, or partial. A stale
`ready: true` result is replaced with the closed result before every startup,
shutdown, and failed health transition.

## Recovery boundary

Before either Rust ownership ledger is installed, stop Ticketry and restore
the verified generation-one snapshots together, preserving the failed inputs
for diagnosis. Remove stale SQLite WAL/SHM sidecars only while the application
is stopped.

The WorkTracker ledger's `write_enabled_at` and the Slice 2 settings ledger are
the no-automatic-return boundary. After a Rust mutation, do not restore a
pre-cutover snapshot or enable Django writers: that can discard settings,
catalogue, workflow policy, or transition facts. Preserve the database, JSON
assets, snapshots, cutover/readiness evidence, and logs for manual salvage.
No automatic Django downgrade exists.
