# Feature map

One document per capability: what it does, its entry points, how to extend it
and how it is tested.

| Document | Covers |
| --- | --- |
| [How to add a capability](how-to-add-a-capability.md) | The supported authoring path for common tasks, with status and closest example. Start here. |
| [Frontend mutations](frontend-mutations.md) | Declared Apollo mutations: the shared executor, its write/commit/refresh phases, error contract, hooks, the migrated work-item, project and workflow writes, and tests. |
| [MCP server and tools](mcp-server-and-tools.md) | The MCP listener, typed tool surface and its tests. |
| [Settings](settings.md) | The versioned provider catalog registry and its delivery gates. |

## Reuse gate

`npm run reuse:check` ([`scripts/reuse-check.mjs`](../../scripts/reuse-check.mjs),
rules in [`scripts/reuse-gate/`](../../scripts/reuse-gate)) runs the repository
reuse rules. It exits non-zero only on a blocking finding. Today it covers:

- **Guidance consistency (blocking):** `AGENTS.md` and `CLAUDE.md` each contain
  one `reuse-rule:start` / `reuse-rule:end` section, and the two sections are
  identical.
- **Feature-map links (blocking):** every relative link in `docs/feature-map/`
  resolves to an existing file, and every `#anchor` matches a heading. External
  URLs are not fetched.
- **Feature-map index (advisory):** every feature-map document is listed above.
- **Proposed owners (blocking):** in the
  [capability guide](how-to-add-a-capability.md), a row cell that says
  Proposed must link each Story key it names to a document whose file name
  carries that key, such as the Story's spec under `docs/plans/`.
- **Provider-catalog modules (blocking):** a model or reasoning change is a
  [catalog registry entry](settings.md#add-a-model-or-change-its-reasoning-levels).
  In the settings crate's `provider_catalog_migrations/` folder only
  `catalog_*` modules and files under `catalog_*` folders, `*_tests` modules,
  `ledger` and `mod` are approved; any other module blocks unless
  [`provider-catalog-exceptions.mjs`](../../scripts/reuse-gate/provider-catalog-exceptions.mjs)
  lists it with a reason. An exception whose file no longer exists also blocks.
- **Duplicated code (advisory):** jscpd scans handwritten TS/TSX, the Node
  scripts and the Tauri Rust crates
  ([`scan-config.mjs`](../../scripts/reuse-gate/duplication/scan-config.mjs)
  holds the scope and the ignore list, one reason per entry). A clone missing
  from the committed
  [`baseline.json`](../../scripts/reuse-gate/duplication/baseline.json) is a
  warning that names both locations; a baseline entry with no current clone is
  a stale warning. Neither ever fails the gate. A clone's identity is its sorted
  file pair plus a hash of the whitespace-normalised fragment, so line shifts do
  not churn it. `npm run reuse:baseline` rewrites the baseline; review its diff
  like code.

Its tests run with `npm run reuse:test`. A rule blocks only when the violation
is objectively detectable and a Supported-now replacement exists.

The [CODING-2730 evidence](../plans/CODING-2730-reuse-gate-evidence.md) records
the tool evaluation, the baseline, passing, advisory and blocking runs, one
worked reuse finding, one justified custom implementation and the
[next-change measurement](../plans/CODING-2730-reuse-gate-evidence.md#measurement-the-next-provider-model-coding-2771).

### In CI

The [CI workflow](../../.github/workflows/ci.yml) runs a step named "Reuse and
boundary gates" right after `npm ci`, before the Studio tests, build, and the
Rust and desktop tests. The step runs:

- `npm run reuse:check`, and `npm run reuse:test`, its tests. Studio Vitest
  runs only `studio/src` tests, so no other step runs them;
- `npm run lld:check:test`, the LLD checker's tests;
- `npm run boundary:check`;
- `npm run caller:check`, the shipping caller gate, and
  `npm run caller:check:test`, its tests;
- `npm run graphql:drift --workspace @worktracker/studio`, the generated-contract
  drift check. No other CI step runs it. The step before it installs the
  `sea-orm-cli` version that `Cargo.lock` pins.

The frontend architecture lint runs inside `npm run build`.
