# CODING-583 Slice 2 dogfood record

Status: pending operator daily-driver observation
Decision: **NO-GO until the copied-installation pass and both ordinary-data days are complete**
Date opened: 2026-08-12

## Automated gate

The implementation validation transcript belongs below. It must include the
focused Rust adoption/settings/provider/launch-policy/MCP suites, Django
ownership and effect-port compatibility tests, generated schema/operation drift
checks, TypeScript checks, the full numbered overhaul gate, and packaged
restart/recovery coverage.

Automated coverage must prove malformed/unknown inputs fail before a ledger or
snapshot is created, verified snapshots reopen with unchanged digests and row
counts, restart is idempotent, partial readiness is rejected, and legacy
Django routes do not become a fallback writer.

## Verified-copy pass

Use `MUXED_DATA_DIR` with a private copy. Do not point the first pass at the
ordinary installation.

* [ ] Verify settings, profile selection, feature flags, module links, and
  keybindings before and after restart.
* [ ] Activate/deactivate providers and change global provider/model/reasoning
  defaults; verify every picker converges without a REST write.
* [ ] Create, update, and clear launch bindings; toggle auto-start and
  subtree-run policy; verify revision conflicts have no partial effect.
* [ ] Exercise interactive launch, auto-start, and subtree launch through Rust
  policy with exactly one Django effect receipt for each idempotency key.
* [ ] Stop and restart between policy authoring and effect consumption; verify
  no duplicate launch and no loss of the selected profile/module link.
* [ ] Inject a pre-write readiness failure, locate and reopen the verified
  snapshots, and confirm no ownership ledger or `ready: true` result was published.
* [ ] Inspect `.ticketry-dev/logs/ticketry.log` for credentials, private paths,
  fallback REST writes, Python MCP writes, duplicate effects, or partial-ready
  command acceptance.

### Verified-copy attempt — 2026-08-12 12:34 CDT

The current unsigned shipping bundle was built and launched with a private,
permission-restricted copy of the ordinary installation. The first release
build exposed a packaging defect: Tauri selected the GraphQL binding exporter
instead of the `ticketry` desktop binary. `Cargo.toml` now declares
`default-run = "ticketry"`, a release regression test covers the selection,
and the corrected complete release build passed. The real installed-artifact
gate then exposed an invalid durable-terminal fixture: it assumed a fresh
installation already had a project/task and omitted the non-null
`runtime_cleanup_pending` value. The driver now provisions an isolated valid
project/module/task fixture when required and supplies the complete terminal
row; all 53 release tests and the real installed-artifact acceptance run pass.

The corrected bundle then failed closed before adoption with
`settings_database_open`: the copied SQLite database predates
`worktracker_provider`, while the ordinary installation's enabled database
marker selects PostgreSQL as its current authority. The live PostgreSQL source
contains 13 app settings, 4 providers, 8 models, 6 reasoning levels, 27
model/reasoning joins, and 240 launch bindings. This repository deliberately
refuses PostgreSQL WorkTracker adoption until a separately acceptance-tested
import exists, so the copied-installation workflow cannot proceed to command
exercise on this installation.

No ownership ledger, cutover record, or snapshot was created. The aggregate
readiness record remained closed (`ready: false`, all four components false,
and `django_write_fallback: false`). The copied database, profile asset, and
feature asset remained byte-identical to their sources:

* `state.db`: `55f8cb4f10f2efed6db46814ca833cc27e3df39671838d55fc1e8cd2093c42be`
* `profiles.json`: `2f49a60714c79ff5518111feeaaa15be59022e69f5d23c7dd17c4360be822e4b`
* `features.json`: `59490aa0d55e82006de7487c9b6c33e1afe1f374c2d5fc57544de60bc3b6c2ef`

Decision: **NO-GO**. A consistent PostgreSQL-to-canonical-SQLite import with
row-count, identity, relationship, timestamp, and semantic-digest parity must
be implemented and validated before this machine can complete the verified
copy and ordinary-data portions of the gate.

## Ordinary-data daily driver

* [ ] Day 1: settings edits, provider default changes, workflow policy edits,
  interactive launch, auto-start, subtree launch, restart, and recovery
  observation completed without fallback, lost state, or duplicate effects.
* [ ] Day 2: repeat the same ordinary workflows after another cold restart;
  record all friction and failures, even if the final decision remains no-go.

### Observations

Not performed in this coding session. A human operator must record dates,
installation identity, readiness evidence digest, failures, and the final GO or
NO-GO decision here after two working days.

## Validation transcript

Automated implementation gate completed 2026-08-12:

* `cargo +1.95.0 test --offline --manifest-path studio/src-tauri/Cargo.toml --no-fail-fast`
  — full Rust unit, GraphQL, adoption, settings, provider, launch-policy, MCP,
  restart/recovery, tmux, and shape-parity suite passed.
* `DJANGO_SETTINGS_MODULE=studio_server.test_settings MUXED_FORCE_SQLITE=1
  MUXED_DATA_DIR=/private/tmp/ticketry-tests-583 .venv/bin/pytest
  apps/execution/tests apps/settings_store/tests
  worktracker/tests/test_route_registry.py
  worktracker/tests/test_write_ownership.py -q` — 245 passed.
* Focused packaged sidecar startup/readiness and secret-preserving restart tests
  — 2 passed.
* `npm run contract:check` — OpenAPI, TypeScript/Python SDK, and wire contract
  artifacts are current after regeneration.
* `npm run graphql:drift --workspace @worktracker/studio` — generated GraphQL
  schema and operations are deterministic and drift-free.
* `npm run typecheck --workspace @worktracker/studio` — passed.
* `npm run test:overhaul --workspace @worktracker/studio` — full numbered gate
  passed (43 files, 100 tests).
* `npm run build --workspace @worktracker/studio` — passed.
* `npm run release:build --workspace @worktracker/studio -- --allow-unsigned`
  — corrected full app and DMG build passed, including architecture, embedded
  sidecar/hook, native resource, signing-integrity, and staging checks.
* `npm run release:test --workspace @worktracker/studio` — 53 passed.
* `npm run release:acceptance --workspace @worktracker/studio` — real isolated
  installed-artifact clean-install, upgrade, restart/recovery, durable terminal,
  skill, diagnostic, and uninstall-preservation gate passed.
* `git diff --check` — passed.

The automated gate does not substitute for elapsed operator observation. The
verified-copy pass and both ordinary-data working days above remain unchecked,
so the recorded release decision remains **NO-GO** and CODING-583 must remain in
Implement until that evidence is added.
