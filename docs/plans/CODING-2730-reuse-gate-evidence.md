# CODING-2730 reuse gate evidence

Evidence for the CODING-2730 reuse process. CODING-2769 recorded the
duplication-tool evaluation and baseline, CODING-2770 and CODING-2773 the CI
wiring. CODING-2771 adds the gate outputs for every run kind, the two
demonstrations and the next-change measurement:

- [Gate output: passing, advisory and blocking](#gate-output-passing-advisory-and-blocking-coding-2771)
- [Demonstration 1: add a provider model](#demonstration-1-add-a-provider-model-coding-2771)
  (configuration-oriented, a reuse finding)
- [Demonstration 2: work-item reorder](#demonstration-2-work-item-reorder-coding-2771)
  (behaviour-oriented, justified custom code)
- [Measurement: the next provider model](#measurement-the-next-provider-model-coding-2771)
- [Follow-ups](#follow-ups-coding-2771)

Neither demonstration is a merged product change. Each was a dry run in the
working tree, reverted afterwards, and lives only in this document.

## Duplication tool evaluation (CODING-2769)

Date: 2026-10-11, checkout `refactor/code-refactor` @ 1b4deda1 plus the
uncommitted CODING-2730 work.

**Tool: jscpd 5.4.1**, a root dev dependency. Version 5 is a self-contained
Rust binary that npm installs per platform. It needs no Java, Python or
global install, so `npm ci` gives CI the same tool as a developer.

**Rust support: adequate, so there is no fallback.** jscpd tokenises Rust
natively, as it does TypeScript, TSX and JavaScript. Its clones are real
token-level duplicates that cross crate boundaries. One example is the
directory-trust test setup duplicated between
`app/ticketry-desktop/src/desktop/commands/directory_trust.rs` and
`foundation/ticketry-provider/tests/directory_trust.rs`. The full scope
(about 1,800–2,100 files) scans in under one second. Pinning
`--workers 1` keeps the clone set stable between runs.

**Scope.** These roots are scanned:

- `studio/src` (TS/TSX);
- `scripts` and `studio/scripts` (the repository's Node `.mjs` scripts);
- `studio/src-tauri/src`, `studio/src-tauri/crates` and `studio/src-tauri/tests` (Rust).

[`scripts/reuse-gate/duplication/scan-config.mjs`](../../scripts/reuse-gate/duplication/scan-config.mjs)
holds the scope and the ignore list, with one reason per entry. The ignore list covers:

- generated GraphQL SDL, bindings and typed documents;
- the SeaORM entities that `graphql:drift` regenerates;
- the `@generated` settings entity;
- `node_modules`, `target`, `dist` and fixtures;
- Tauri `gen`, vendored libghostty, and the EventCatalog and model-catalog sites.

jscpd also respects `.gitignore`.

**Threshold: jscpd's default of 50 tokens.** Clone counts across the same
scope at other thresholds (raw jscpd counts, before baseline de-duplication):

| Min tokens | Clones | Duplicated lines |
| ---: | ---: | ---: |
| 30 | 4,131 | 11.76% |
| 50 | 1,663 | 6.18% |
| 70 | 740 | 3.61% |
| 100 | 277 | 2.03% |

At 50 tokens a clone is typically 6–10 lines: a repeated setup block or a
copied branch, which is large enough to discuss. At 30 tokens most matches are
import blocks and struct literals. At 100 tokens real copied helpers are
missed. The findings are advisory, so the default stays. Tune it only with
evidence from reviews where a finding was noise or a copy was missed.

The percentages describe the scan. They are not a target, quota or score, and
the gate does not read them.

## Baseline (CODING-2769)

[`scripts/reuse-gate/duplication/baseline.json`](../../scripts/reuse-gate/duplication/baseline.json)
records **1,549 clones**, about 123k duplicated tokens. By file type:

| Type | Clones |
| --- | ---: |
| Rust | 989 |
| TSX | 445 |
| TS | 64 |
| `.mjs` | 51 |

Each entry has the sorted repository-relative file pair, a 16-hex SHA-256 of
the whitespace-normalised fragment, and the clone's token and line size. It
records no line numbers, so an edit elsewhere in either file does not change
the entry. CODING-2769 does not refactor any of this existing duplication.

`npm run reuse:baseline` rewrites the file. Two consecutive runs produced
byte-identical files (`cmp` clean).

## Gate behaviour on the real repository (CODING-2769)

With the committed baseline the gate is clean and exits 0:

```text
$ npm run reuse:check
reuse:check: 0 blocking, 0 advisory
```

To produce a **new clone**, I copied
`studio/src/features/agents/status/stream/statusStreamFeed.ts` into a
throwaway feature folder. The gate warned and still exited 0:

```text
advisory studio/src/features/agents/status/stream/statusStreamFeed.ts:11 duplication/new-clone: new duplicated code (1945 tokens, 432 lines) between studio/src/features/agents/status/stream/statusStreamFeed.ts:11-442 and studio/src/features/zz-demo/copy.ts:11-442; check docs/feature-map/how-to-add-a-capability.md for an existing module or discuss reuse before keeping both
reuse:check: 0 blocking, 1 advisory
```

To produce a **stale entry**, I added a baseline entry for a clone that does
not exist. The gate warned and exited 0:

```text
advisory scripts/reuse-gate/duplication/baseline.json duplication/stale-baseline-entry: baselined clone 0123456789abcdef between scripts/removed-a.mjs and scripts/removed-b.mjs no longer exists; run npm run reuse:baseline and review the diff
reuse:check: 0 blocking, 1 advisory
```

Under GitHub Actions both findings print as `::warning` annotations.

## CI wiring (CODING-2770)

Date: 2026-10-11, checkout `refactor/code-refactor` @ 1b4deda1 plus the
uncommitted CODING-2730 work.

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) now has a step
named **Reuse and boundary gates**. It runs right after `npm ci` and the
`sea-orm-cli` install, before the Studio typecheck, tests and build and before
the Rust and desktop tests. The step ran the first four commands below;
CODING-2773 later added the next two and CODING-2796 the last one:

| Command | In the step | Local result on the branch |
| --- | --- | --- |
| `npm run reuse:check` | Yes | Pass |
| `npm run lld:check:test` | Yes | Pass (7 of 7 tests) |
| `npm run boundary:check` | Yes | Pass |
| `npm run graphql:drift --workspace @worktracker/studio` | Yes. No other CI step ran it before | Pass (about 40 s) |
| `npm run caller:check` | Yes, since CODING-2773 (it failed on `main` before) | Pass |
| `npm run caller:check:test` | Yes, since CODING-2773 | Pass (12 of 12 tests since CODING-2791) |
| `npm run reuse:test` | Yes, since CODING-2796. No other CI step ran it before | Pass (26 of 26 tests since CODING-2797) |

The drift check runs `sea-orm-cli`. The runner image does not have it, so a new
step, "Install generated-contract prerequisite", installs the version that
`Cargo.lock` pins, in the same way as `scripts/codex-cloud/install.sh`. Rules
added to the reuse gate later, such as the catalog per-model rule and
duplication reporting, run inside `reuse:check` without another CI change.

Passing output:

```text
$ npm run reuse:check
reuse:check: 0 blocking, 0 advisory

$ npm run lld:check:test
# tests 7
# pass 7
# fail 0

$ npm run boundary:check
Boundary check passed: no worktracker_gateway package/app/import surface found.

$ npm run graphql:drift --workspace @worktracker/studio
GraphQL foundation generation is deterministic and drift-free
```

**Historical baseline (CODING-2770): `caller:check` failed on `main`.** When
CODING-2770 wired the step, the command gave this output on `main` @ 0116672e
(using a `git archive` export of `main`). It gave the same output on this branch
at that point:

```text
$ npm run caller:check
Shipping caller gate failed:
studio/src/runtime/browserRuntime.ts:20: retired status or terminal socket (via studio/src/main.tsx -> studio/src/runtime/index.ts)
studio/vite.proxy.ts: development proxy exposes retired REST or WebSocket routing
```

The failure had nothing to do with CODING-2730, so CODING-2770 left the code
alone. It kept `caller:check` out of the CI step, added a `ci.yml` comment
linking CODING-2773, and handed the fix to that work item.

**Current status: resolved by CODING-2773.** On this branch `caller:check`
passes, the CI step runs it with `caller:check:test`, and the exclusion comment
is gone. The next section has the cause, the gate changes and the passing
output.

## Shipping caller gate in CI (CODING-2773)

Date: 2026-10-11, checkout `refactor/code-refactor` @ 1b4deda1 plus the
uncommitted CODING-2730 work.

**The gate was out of date; the code was right.** Both findings above are the
supported browser terminal path. Browser development attaches to durable runs
through the `browserTerminalClient` WebSocket adapter, which opens the Rust
adapter's attach-only `/ws/terminal` socket. The development proxy forwards
that one route with WebSocket upgrades enabled. CLAUDE.md, AGENTS.md and
`studio/src/test/overhaulTerminalTransportRetirementAcceptance.test.tsx`
already describe this design. The gate still treated every `/ws/terminal`
reference, every `new WebSocket(` and every proxy `ws:` flag as retired.

Changes to `scripts/shipping-caller-gate.mjs`:

- A `/ws/<route>` other than `/ws/terminal` fails as a "retired status
  socket".
- `new WebSocket(` fails everywhere except
  `studio/src/features/agents/terminal/internal/browserTerminalClient.ts`.
- `studio/vite.proxy.ts` may upgrade only the `/ws/terminal` entry. An `/api`
  route, a `ws:` flag on another entry, or another `/ws/` route still fails.
- `--root <dir>` runs the gate on another checkout, so the tests can use
  fixture trees.

`scripts/shipping-caller-gate.test.mjs` (`npm run caller:check:test`) covers
the real checkout passing, the fixture attach socket passing, and the four
retired shapes failing. Removing any one of the three new rules makes a test
fail. The CI step "Reuse and boundary gates" now runs `npm run caller:check`
and `npm run caller:check:test`, and the exclusion comment is gone.

```text
$ npm run caller:check
Shipping caller gate passed across 529 reachable Studio modules.

$ npm run caller:check:test
# tests 7
# pass 7
# fail 0
```

CODING-2791 later narrowed the exemption to the exact `/ws/terminal` path.
Before that change, `/ws/terminal-status`, `/ws/terminal/status` and
`/ws/terminals` slipped past the retired-socket rule. It also added five fixture
cases. On 2026-10-12, `caller:check` still passes across 529 reachable Studio
modules, and `caller:check:test` passes 12 of 12 tests.

## Reuse gate tests in CI (CODING-2796)

Date: 2026-10-12, checkout `refactor/code-refactor` @ 1b4deda1 plus the
uncommitted CODING-2730 work.

The step ran `reuse:check` against the unchanged repository but never
`npm run reuse:test`. Studio Vitest includes only `src/**/*.test.{ts,tsx}`, so
no later step ran the root `.mjs` suites either. A regression that dropped
new-clone warnings or stopped blocking new catalog modules could pass CI. The
step "Reuse and boundary gates" now runs `npm run reuse:test` right after
`npm run reuse:check`. A test in `scripts/reuse-check.test.mjs` reads
`ci.yml` and fails when that step no longer runs `npm run reuse:test`; it
failed before the `ci.yml` change.

```text
$ npm run reuse:test
# tests 23
# pass 23
# fail 0
```

## Proposed owners linked in the capability guide (CODING-2797)

Date: 2026-10-12, checkout `refactor/code-refactor` @ 1b4deda1 plus the
uncommitted CODING-2730 work.

The guide's Proposed rows named CODING-2727 and CODING-2728 in plain text, and
the Setting row named CODING-2729 the same way, so a developer could not reach
the decisions or the current fallback for a path the guide says is not usable
yet. Each key now links its Story spec under `docs/plans/`. CODING-2728 and
CODING-2729 already had specs. CODING-2727 had none in the repository, so
[`CODING-2727-generated-frontend-contracts-spec.md`](CODING-2727-generated-frontend-contracts-spec.md)
condenses its approved Spec and names the current pattern until delivery. The
Mutation cache effects row now links a concrete current example. Status labels
are unchanged; nothing in these Stories is implemented or enforced here.

A new blocking rule, `capability-guide/unlinked-owner`, fails when a guide
table cell that says Proposed names a Story key that no link in the row
carries in its file name. Before the guide change it reported exactly the
three rows (lines 25, 28 and 29); after it, the gate is clean of blocking
findings.

```text
$ npm run reuse:test
# tests 26
# pass 26
# fail 0
$ npm run reuse:check
reuse:check: 0 blocking, 27 advisory
```

The advisory findings are clone and stale-baseline warnings from concurrent
Rust and test changes, not from this change.

## Workspace crate tests in CI (CODING-2780)

Date: 2026-10-12, checkout `refactor/code-refactor` @ 1b4deda1 plus the
uncommitted CODING-2730 work.

The **Desktop Rust tests** step in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) now runs:

```bash
cargo test --manifest-path studio/src-tauri/Cargo.toml --workspace --features ticketry/native-libghostty --no-fail-fast
```

`--workspace` selects every member of `members = [".", "crates/*/*"]`, so the
crates' own unit and integration tests run alongside the root package's.
`native-libghostty` is named as `ticketry/native-libghostty`, which keeps it on
the root package; the root package forwards it to `ticketry-desktop`.
`default-members` was not used: it would also change what a bare
`cargo build` or `cargo run` selects locally.

Crate tests that failed when they first ran, and what changed:

| Test | Cause | Change |
| --- | --- | --- |
| `ticketry-installation` `import::canonical::tests::canonicalizes_every_cross_engine_type` | A real bug. The workspace graph enables serde_json's `preserve_order` (through `schemars` and others), so `serde_json::Value` kept insertion order and `canonical_json` was not canonical. PostgreSQL `jsonb` and SQLite text could digest the same object differently. | `canonical_json` sorts object keys at every depth. The test gained a nested object-in-array case. |
| `ticketry-desktop` `service_health::tests::failed_health_points_to_the_application_log_without_expanding_its_shape` | The same feature: under `--workspace`, serialized keys keep field order. The test asserts the field set. | The test sorts the keys before comparing. |
| `ticketry-documents` `document_watch::*` (14 tests) | The hand-written `agent_runs` fixture lacked the `attention_reason` column the entity gained. | The fixture creates the column. |
| `ticketry-settings` `provider_catalog_migrations`, `ticketry-installation` `final_schema_migrations::tests` and `sprint_migration_chain` | Not a code defect. Locally they reported a `0065_codex_6_2_terra_model_catalog` step that no source contains: the CODING-2771 dry run restored the registry file with its old mtime, so Cargo reused stale builds. | None. They pass after the sources are touched. CI builds from a clean checkout. |
| `ticketry-tool-discovery` `discovers_a_package_manager_fixture_without_path_or_shell`, `approved_absolute_path_is_persisted_and_preferred_on_relaunch` | "version probe timed out": the 2 s version-probe timeout expired while the machine was compiling the workspace. | At the time, none: they passed when re-run with the same feature set. The root package's `graph_run_service` `an_invalid_armed_root_does_not_starve_a_later_ready_root` failed the same way in one full run. CODING-2793 resolved the timeout under load; see below. |

With these changes, the CI command passes every workspace crate's tests on
this checkout apart from that timeout. The root package still fails tests
that already fail under the old command (`cargo test --features
native-libghostty`, root package only), so `--workspace` did not cause them:
`graphql_foundation` (`Type "AgentExecutions" not found`),
`graphql_view_registration_contract` (scans 22 crates, expects 21),
`installation_adoption`, `instant_launch_settings_graphql`,
`keybinding_settings_graphql`, `module_graph`, `run_status_subscription`,
`task_launch_prompt`, `tmux_session_naming` and `workspace_operation_journal`.
They belong to the uncommitted sprint and MCP work on this branch, not to
CODING-2780.

## Passing workspace test run (CODING-2793)

Date: 2026-10-12, checkout `refactor/code-refactor` @ 1b4deda1 plus the
uncommitted branch work. The exact **Desktop Rust tests** command passes,
exit code 0, after the CI prerequisites (`npm run libghostty:prepare
--workspace @worktracker/studio` and the staged `ticketry-hook` sidecar):

```bash
cargo test --manifest-path studio/src-tauri/Cargo.toml --workspace --features ticketry/native-libghostty --no-fail-fast
```

It took three full runs. The first reproduced the failures listed above
(`installation_adoption` had since gone green). The second showed three new
failures: the compaction race and the new slow-probe test failed under load,
and the stalled-`gh` test still encoded the old 2 s bound. The third was clean. The machine's load
average stayed between 13 and 42 on 10 cores, because other sessions were
building in parallel, so the passing run was not a quiet one.

No assertion was removed or loosened. Each failure was fixed at its cause:

| Failing target | Cause | Change |
| --- | --- | --- |
| `graphql_foundation`, `instant_launch_settings_graphql`, `keybinding_settings_graphql`, `run_status_subscription`, `workspace_operation_journal` | Product defect: `Type "AgentExecutions" not found`. Sprint execution registered its views in every schema, but the `agent_executions` entity is only registered with the product's execution entities, so every schema built without a WorkTracker database failed. | `ticketry-graphql-schema` `query_root.rs` registers sprint execution only when `product_generated_mutations` is set, the same gate `graph_run` uses. |
| `graphql_view_registration_contract`, `tmux_session_naming`, `module_graph` | Stale inventory counts: `ticketry-planner` is a new crate, so there are 22 crates (21 named `ticketry-*`). | The scan counts are now 22, 22 and 21, as d34566a9 did for the previous crate. |
| `graphql_view_registration_contract` (`migrated_graphql_registrars_use_nested_view_owned_bindings`) | Four sprint registrars called `register_restricted_model_mutation` outside `views/<field>/mod.rs`. | Moved them under `sprint_suggestions/views/{create,update}/`, `sprint_goal/views/{create,update,delete}/` and `sprint_suggestion/views/update/`. The SDL, field names and public API are unchanged. |
| `task_launch_prompt` (3 tests) | Stale fixture. a2541323 made Run Now convert a Story into the project's Implementation type and launch with that type's Implement binding. The fixture renamed the harness's only task type to "Story", so Run Now refused with `implementation_not_configured`. | The fixture seeds an Implementation type that owns the Implement launch binding. The prompt assertions are unchanged. |
| `slice6_execution_recovery` (5 tests) | Product performance defect. The MCP socket answered, but `execute_dependency_graph` took about 2.2 s idle and more than the test client's 5 s under load. `ticketry_terminal::approved_tool_path` ran a full `preflight_report()`, which version-probes all six supported tools, to look up one path, and a launch calls it about ten times. | `approved_tool_path` calls `discover_tool(tool)` instead, which is the same per-tool lookup. One call fell from about 200 ms to 13 ms, `execute_dependency_graph` from about 2.26 s to 0.54 s, and the binary from about 55 s to 25 s. |
| `temporary_profile_teardown` and the earlier `ticketry-tool-discovery` timeouts | The 2 s version-probe bound includes spawn time, and it expired for trivial probe scripts under full-workspace load. | Owned decision: `VERSION_PROBE_TIMEOUT` is now 5 s. It bounds a hung tool, and a healthy Node-based launcher can take seconds to answer on a busy desktop. With the fix above, the bound applies to one probe per lookup instead of six. The hung-probe tests scale with it: the helper outlives the bound, the elapsed limit is 6 s, and the stalled `gh` in `ticketry-workspace-runtime` sleeps 10 s under an 8 s outer timeout. They still prove the bound and the cleanup of the helper process. |
| `startup_compaction_schedule` (`the_periodic_driver_runs_the_pass_again`, second run) | Test race. A pass commits its watermark before it deletes, by design. The test stopped polling once the watermark moved and then aborted the driver, which could cut the deletes short. | The test waits for the whole pass (watermark advanced and the backlog pruned) before aborting. Both final assertions are unchanged. It passed five times in a row. |

A regression test for "a healthy 3 s probe is accepted" was tried. It
failed in the second run at a load average of 42. It pins a tuning constant
against the wall clock, so it was removed rather than kept as a flaky guard.

Six tests are ignored, and every ignore predates this work:
`print_module_graph`, `compare_adoption_startup_cost` and
`installation_reopen_cost` need diagnostic or benchmark setup; `runtime_process`
and `interactive_launch_authority::worktree_launch_trust_child` are subprocess
children of other tests; `installed_gemini_connects_mcp_after_explicit_folder_setup`
needs an installed Gemini CLI.

Per-crate inventory of the passing run (unit, integration and doc-test targets):

| Package | Targets | Passed | Failed | Ignored |
| --- | ---: | ---: | ---: | ---: |
| `ticketry (root)` | 91 | 756 | 0 | 3 |
| `tauri-graphql` | 3 | 6 | 0 | 0 |
| `ticketry-agent-execution` | 3 | 56 | 0 | 0 |
| `ticketry-codex-app-server` | 3 | 15 | 0 | 0 |
| `ticketry-data-directory` | 2 | 13 | 0 | 0 |
| `ticketry-desktop` | 2 | 116 | 0 | 0 |
| `ticketry-dev-tools` | 12 | 34 | 0 | 0 |
| `ticketry-diagnostics` | 2 | 70 | 0 | 0 |
| `ticketry-documents` | 3 | 79 | 0 | 0 |
| `ticketry-entities` | 3 | 3 | 0 | 0 |
| `ticketry-graphql-schema` | 9 | 31 | 0 | 0 |
| `ticketry-hook` | 5 | 13 | 0 | 1 |
| `ticketry-installation` | 4 | 96 | 0 | 0 |
| `ticketry-launch` | 5 | 72 | 0 | 2 |
| `ticketry-mcp` | 2 | 50 | 0 | 0 |
| `ticketry-planner` | 4 | 8 | 0 | 0 |
| `ticketry-provider` | 18 | 38 | 0 | 0 |
| `ticketry-runs` | 2 | 44 | 0 | 0 |
| `ticketry-settings` | 3 | 43 | 0 | 0 |
| `ticketry-terminal` | 3 | 123 | 0 | 0 |
| `ticketry-tool-discovery` | 2 | 13 | 0 | 0 |
| `ticketry-work-management` | 2 | 69 | 0 | 0 |
| `ticketry-workspace-runtime` | 3 | 129 | 0 | 0 |
| **Total** | 186 | 1877 | 0 | 6 |

## Gate output: passing, advisory and blocking (CODING-2771)

Date: 2026-10-11, checkout `refactor/code-refactor` @ 1b4deda1 plus the
uncommitted CODING-2730 work. All three runs use the real repository and the
committed baseline (still **1,549 clones**, unchanged since CODING-2769). The
command is `npm run reuse:check`. Under GitHub Actions the same findings print
as `::error` (blocking) and `::warning` (advisory) annotations.

| Run | Trigger | Findings | Exit code |
| --- | --- | --- | ---: |
| Passing | The branch as committed, and again with the Demonstration 1 registry entry | 0 blocking, 0 advisory | 0 |
| Advisory | Demonstration 2: the work-item reorder clones treated as new | 0 blocking, 7 advisory | 0 |
| Blocking | Demonstration 1: a per-model catalog module | 1 blocking, 0 advisory | 1 |

Passing:

```text
$ npm run reuse:check
reuse:check: 0 blocking, 0 advisory
```

The advisory and blocking outputs appear verbatim under each demonstration.

## Demonstration 1: add a provider model (CODING-2771)

**Kind:** configuration-oriented change. **Outcome:** a reuse finding. The
behaviour is already owned by the catalog registry, so no new module is
written.

Scenario: add a hypothetical Codex model, `gpt-6.2-terra`, with reasoning
`low` through `ultra`. I ran it as a dry run in the working tree and restored
every file afterwards.

### Reuse record

The same table shape as the LLD template's `reuse-record` section.

| Category | Behaviour | Closest example | Justification |
| --- | --- | --- | --- |
| Reused | Transaction, ledger provenance, deferral on missing tables, provider lookup, model/reasoning reconciliation and rerun identity | `studio/src-tauri/crates/config/ticketry-settings/src/provider_catalog_migrations/catalog_runner.rs` and `catalog_reconciliation.rs` | The shared runner applies every registry entry. A new model needs none of this written again. |
| Reused | Installation-chain placement, startup error label and owned-ledger classification | `studio/src-tauri/crates/execution/ticketry-installation/src/final_schema_migrations.rs` and `classification/rust_ledger.rs` | Both read the registry's descriptors, so they pick up a new entry without edits. |
| Generated or configured | The model, its reasoning levels, migration id, ledger, source commit and chain step | `CODEX_6_1_SOL` in `studio/src-tauri/crates/config/ticketry-settings/src/provider_catalog_migrations/catalog_registry.rs` | One declarative `CatalogEntry` in `REGISTRY`, following the [settings how-to](../feature-map/settings.md#add-a-model-or-change-its-reasoning-levels). Registry validation checks identities and step order. |
| New | none — the model needs no behaviour that the registry and runner do not already provide | — | `handler: None`. A handler is only for behaviour that reconciliation cannot express, such as the Astra rename. |

The [capability guide](../feature-map/how-to-add-a-capability.md) row
"Provider model and reasoning levels" leads straight to this record.

### The gate blocks the per-model-module alternative

I recreated the pre-CODING-2725 shape: the deleted `codex_6_1_sol.rs` wrapper
from `HEAD`, renamed to `codex_6_2_terra.rs` in `provider_catalog_migrations/`.

```text
$ npm run reuse:check
BLOCKING studio/src-tauri/crates/config/ticketry-settings/src/provider_catalog_migrations/codex_6_2_terra.rs provider-catalog/per-model-module: add a catalog registry entry instead of a per-model module; see docs/feature-map/settings.md#add-a-model-or-change-its-reasoning-levels
reuse:check: 1 blocking, 0 advisory
$ echo $?
1
```

### The gate passes with a registry entry

I deleted the module and added this entry to `REGISTRY` instead (step 65 is the
next unused step across the registry and installation's `non_catalog.rs`, whose
last step is 64):

```rust
/// GPT-6.2 Terra with the reasoning levels advertised by the Codex model catalog.
pub(super) const CODEX_6_2_TERRA: CatalogEntry = CatalogEntry {
    migration_id: "0065_codex_6_2_terra_model_catalog",
    ledger: "ticketry_codex_6_2_terra_catalog_migration",
    source_commit: "1b4deda11d860436e140575aed97f9553483ec12",
    step: 65,
    provider: "codex",
    missing_provider: MissingProvider::Fail,
    handler: None,
    models: &[CatalogModel {
        name: "gpt-6.2-terra",
        reasoning: &["low", "medium", "high", "xhigh", "max", "ultra"],
    }],
};
```

```text
$ npm run reuse:check
reuse:check: 0 blocking, 0 advisory
```

### The registry entry is the whole change

With only the entry in place, `cargo test -p ticketry-settings -p
ticketry-installation` failed exactly where the how-to's step 3 says to update
test expectations: the frozen identity, content and chain-order lists. I added
the new entry to each list. Then:

- every `ticketry-settings` test passed (39 unit tests, plus the 4 integration
  tests, which install, tamper with, roll back and rerun every registered step,
  now including step 65);
- every `ticketry-installation` catalog and chain test passed.

The root package's catalog integration tests (`final_schema_migration_chain`,
`installation_adoption`, `catalog_registry_installation`, `codex_6_1_catalog`,
`installation_classification` and `provider_catalog`) then failed in two
places: the provisioned model list in `installation_adoption.rs`, and
`fresh_production_entry_reaches_the_final_leaf`, which asserts that
`0063_sprints` is the final migration. After both expectations were updated,
all six targets passed (72 tests).

One `ticketry-installation` unit test,
`import::canonical::tests::canonicalizes_every_cross_engine_type`, failed in
every run, with and without the dry run. It checks JSON key order in the
Postgres import, which does not touch the catalog. See
[Follow-ups](#follow-ups-coding-2771).

## Demonstration 2: work-item reorder (CODING-2771)

**Kind:** behaviour-oriented change. **Outcome:** justified custom code, with
the advisory clone findings discussed and each accepted or refuted.

Subject: `reorder_work_item`, one of the quarantined GraphQL domain operations
listed in CLAUDE.md and in the operation registry. The reuse record below is
written as the record that change should have carried, and checked against the
current code.

### Reuse record

| Category | Behaviour | Closest example | Justification |
| --- | --- | --- | --- |
| Reused | Generated `issue` entity, SeaORM transactions and the Seaography custom-mutation registration | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/work_item/views/update/` | Persistence and schema registration stay with the framework. The mutation returns the authoritative WorkItem through `authoritative_work_item`, as the update contract does. |
| Reused | Fractional rank allocation between two neighbours | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/fractional_rank.rs` | Shared with create and hierarchy moves; reorder calls it rather than computing ranks. |
| Reused | Work-fact recording and project-revision stamping | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/status_facts.rs` | The same event planning every WorkItem write uses. |
| Generated or configured | The exception's place in the live mutation surface and its recorded reason | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/graphql/operation_registry.rs` | One registry entry with its reason. Frontend bindings come from `npm run graphql:generate --workspace @worktracker/studio`. |
| New | Validate that `before_id` and `after_id` are concrete adjacent siblings of the moved item, optionally rebuild a legacy unranked order from `initial_order_ids`, then allocate the rank and record the revision in one locked transaction | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs` | Generated CRUD cannot validate an ordered gap between two other rows, and exposing `rank` as a writable field would break the "never expose ranks" rule. This is why the operation is quarantined. The next ordered list reuses `fractional_rank.rs` and this neighbour check, so it is cheaper to author. |

### Advisory clone findings

To show what a reviewer would have seen when reorder was added, I removed the 7
baseline entries that involve `commands/reorder.rs` (1,549 → 1,542), ran the
gate, and restored the committed baseline byte-for-byte (`cmp` clean):

```text
$ npm run reuse:check
advisory studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/hierarchy.rs:5 duplication/new-clone: new duplicated code (55 tokens, 10 lines) between studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/hierarchy.rs:5-14 and studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs:5-15; check docs/feature-map/how-to-add-a-capability.md for an existing module or discuss reuse before keeping both
advisory studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/hierarchy.rs:276 duplication/new-clone: new duplicated code (106 tokens, 14 lines) between studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/hierarchy.rs:276-289 and studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs:528-541; check docs/feature-map/how-to-add-a-capability.md for an existing module or discuss reuse before keeping both
advisory studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/hierarchy.rs:278 duplication/new-clone: new duplicated code (89 tokens, 12 lines) between studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/hierarchy.rs:278-289 and studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs:498-509; check docs/feature-map/how-to-add-a-capability.md for an existing module or discuss reuse before keeping both
advisory studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/hierarchy.rs:303 duplication/new-clone: new duplicated code (69 tokens, 8 lines) between studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/hierarchy.rs:303-310 and studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs:553-560; check docs/feature-map/how-to-add-a-capability.md for an existing module or discuss reuse before keeping both
advisory studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs:214 duplication/new-clone: new duplicated code (51 tokens, 7 lines) between studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs:214-220 and studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs:221-227; check docs/feature-map/how-to-add-a-capability.md for an existing module or discuss reuse before keeping both
advisory studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs:371 duplication/new-clone: new duplicated code (93 tokens, 12 lines) between studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs:371-382 and studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/work_items/create.rs:174-185; check docs/feature-map/how-to-add-a-capability.md for an existing module or discuss reuse before keeping both
advisory studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs:501 duplication/new-clone: new duplicated code (54 tokens, 9 lines) between studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs:501-509 and studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/reorder.rs:533-541; check docs/feature-map/how-to-add-a-capability.md for an existing module or discuss reuse before keeping both
reuse:check: 0 blocking, 7 advisory
$ echo $?
0
```

### Discussion of each finding

Each finding was read in the source and answered with the three review
questions. Paths below are relative to
`studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/`.

| Finding | Same responsibility? | Decision |
| --- | --- | --- |
| `hierarchy.rs:5-14` ↔ `reorder.rs:5-15` | No. It is the `use` block of two modules that touch the same entities. | **Refuted.** Import lists are not shared behaviour. |
| `reorder.rs:214-220` ↔ `reorder.rs:221-227` | No. They are the `before` and `after` halves of one diagnostic payload. | **Refuted.** A helper would save six lines and hide the payload's shape from the person reading the diagnostic. |
| `hierarchy.rs:278-289` ↔ `reorder.rs:498-509`, `reorder.rs:501-509` ↔ `reorder.rs:533-541` and `hierarchy.rs:276-289` ↔ `reorder.rs:528-541` (neighbour lookup) | Partly. Each loads a neighbour and checks its project, but the rules differ: a hierarchy move requires a sibling at the destination; a task reorder rejects modules; a module reorder rejects non-modules and archived modules and loads the presentation row. | **Refuted as an abstraction.** Only the 5-line "load and check project" preamble is shared. A parameterised neighbour helper would make every caller learn the rule switches, which is the "abstraction that increases caller knowledge" the guidance warns against. The baseline keeps the clones. |
| `hierarchy.rs:303-310` ↔ `reorder.rs:553-560` (`lock_project`) | Yes. Both take the project row lock before a rank write. | **Accepted as a reuse finding, not changed here.** The two copies have already drifted: `reorder.rs` checks that the lock updated a row and `hierarchy.rs` ignores the result. The next ordered write should take the lock from one shared place. |
| `reorder.rs:371-382` ↔ `work_items/create.rs:174-185` ("does this project use a manual module order?") | Yes. Both decide whether the project has a manual module order. | **Accepted as a reuse finding, not changed here.** The copies disagree: `create.rs` ignores archived modules (`IsArchived = false`) and `reorder.rs` does not. One question with two answers is the kind of repeated responsibility the scanner cannot judge on its own. Which answer is right is a product decision, so it is recorded under [Follow-ups](#follow-ups-coding-2771) and not fixed in this documentation ticket. |

The custom code is still justified: none of the findings shows the New row
behaviour to be owned elsewhere. Two findings are real shared
responsibilities, and both carry drift, which is the risk the advisory output
exists to surface.

## Measurement: the next provider model (CODING-2771)

**Question:** how much handwritten work does "add a provider model" take?

- **Old per-model path:** measured from git history before CODING-2725. The
  example is GPT-6.1 Sol in commit `a2541323` (2026-10-02), the last model added
  that way. Counts include only the hunks for that model. The commit also
  carried unrelated work.
- **Registry path:** measured from the Demonstration 1 dry run.

Lines are added/removed lines in the diff.

### Per change, handwritten

| File | Old per-model path (GPT-6.1 Sol) | Registry path (dry-run GPT-6.2 Terra) |
| --- | --- | --- |
| New per-model module `provider_catalog_migrations/codex_6_1_sol.rs` | +56 | — |
| `provider_catalog_migrations/mod.rs` (declare and re-export) | +2 | — |
| `ticketry-settings/src/lib.rs` (crate-root exports) | +6 −6 | — |
| Installation `final_schema_migrations.rs` (import, id list, runner call) | +9 −5 | — |
| Installation `classification/rust_ledger.rs` (owned ledger) | +4 | — |
| `catalog_registry.rs` (entry and `REGISTRY` line) | — | +16 |
| **Production code subtotal** | **5 files, +77 −11** | **1 file, +16** |
| `tests/fixtures/public-api.txt` (public API contract) | +3 | — |
| `tests/final_schema_migration_chain/support.rs` | +6 −2 | — |
| `catalog_registry/tests.rs` (frozen identities and content) | — | +17 |
| Settings `tests/provider_catalog_migrations.rs` (public descriptors) | — | +5 |
| Settings `tests/support/mod.rs` (expected contents for the step) | — | +1 |
| Installation `final_schema_migrations/tests.rs` (chain ids, steps, labels) | — | +4 −3 |
| Installation `tests/sprint_migration_chain.rs` (last-migration assertion) | — | +1 −1 |
| `tests/final_schema_migration_chain.rs` (final-leaf assertion) | — | +1 −1 |
| `tests/installation_adoption.rs` (provisioned model list) | — | +1 |
| **Test-expectation subtotal** | **2 files, +9 −2** | **7 files, +30 −5** |
| **Per-change total** | **7 files, +86 −13** | **8 files, +46 −5** |

### Kept separate from the per-change figure

| Column | Old per-model path | Registry path |
| --- | --- | --- |
| Generated output | 0. A catalog change is data rows; no SDL, bindings or entities change. | 0, for the same reason. |
| One-time shared implementation | Partial: `ledger.rs` and `codex_5_6::apply_model`. Each wrapper still repeated its own transaction, ledger check, table check and provider lookup (about 44 of its 56 lines). | Already paid by CODING-2725 (CODING-2732 to CODING-2736): runner, reconciliation, validation, handler and surface, 5 files and 372 lines; the registry types and `validated()` in `catalog_registry.rs` (the first 59 lines; the rest are entries); and 8 test files, 1,285 lines. Installation's merged chain lives in `final_schema_migrations.rs` and `final_schema_migrations/non_catalog.rs`. |
| Optional per-model acceptance (either path) | The GPT-6.1 Sol commit also added `tests/codex_6_1_catalog.rs` (+82), an `[overhaul-407]` case (+64 −1) and its catalogue row (+1). | Not required by the how-to. A model with user-visible behaviour would add the same cases. |

### What the numbers show

- **Handwritten production code falls from 5 files and 88 changed lines to
  1 file and 16 lines**, and that one file is data. The change no longer
  touches the crate's public API, the installation runner or the owned-ledger
  list, so a new model cannot forget a cross-crate edit. The commit that added
  GPT-6 Sol and Luna (`f3fc16bc`) shows the same shape: a 56-line module, plus
  `mod.rs`, `lib.rs`, `final_schema_migrations.rs` and `public-api.txt` edits.
- **The file count does not fall** (7 before, 8 after), because the registry
  path has more frozen test lists, each holding one literal per entry. That is
  the intended price of protecting historical ledgers. Two of the edits are
  not: `sprint_migration_chain.rs` and `final_schema_migration_chain.rs` each
  assert that `0063_sprints` is the *last* migration, so every future catalog
  entry breaks them. Neither is in the how-to's list, so the next author finds
  them only by running the tests. See [Follow-ups](#follow-ups-coding-2771).
- **Total handwritten changed lines fall from 99 to 51.** This is a measurement, not a
  target. The gate does not read it and no quota rests on it.

## Follow-ups (CODING-2771)

CI follow-ups from the earlier tickets:

- **CODING-2773 (`caller:check` in CI): done.** The step runs `caller:check`
  and `caller:check:test`. See
  [Shipping caller gate in CI](#shipping-caller-gate-in-ci-coding-2773).
- **New: CI does not run the workspace crates' own tests.** CI runs
  `cargo test --manifest-path studio/src-tauri/Cargo.toml`. The manifest has a
  root package (`ticketry`) and no `default-members`, so Cargo tests only that
  package. The `ticketry-settings` and `ticketry-installation` unit and
  integration tests that guard the catalog registry (`catalog_registry/tests.rs`,
  `catalog_runner/tests.rs`, `tests/provider_catalog_migrations.rs`,
  `final_schema_migrations/tests.rs`) are not run in CI. Neither is the
  failing `import::canonical::tests::canonicalizes_every_cross_engine_type`.
  Filed as **CODING-2780: done.** See
  [Workspace crate tests in CI](#workspace-crate-tests-in-ci-coding-2780).

Other findings from the demonstrations, not filed here (each needs an owner's
decision):

- `work_items/create.rs` and `reorder.rs` disagree on whether archived modules
  count towards a manual module order.
- `hierarchy.rs` and `reorder.rs` each have a `lock_project`, and only one
  checks that the lock took effect.
- `ticketry-installation/tests/sprint_migration_chain.rs` and
  `studio/src-tauri/tests/final_schema_migration_chain.rs`
  (`fresh_production_entry_reaches_the_final_leaf`) should assert that
  `0063_sprints` is *in* the chain, or that the final leaf is the registry's
  last step, so catalog entries stop breaking them. **CODING-2800: done.** Both
  now assert sprint membership, historical position, schema and ledger, and
  `npm run test:catalog-append` runs them against a synthetic appended entry.

## Feature map

The CODING-2771 demonstrations add no entry point and change no behaviour. The
[feature-map index](../feature-map/README.md#reuse-gate) links here as the
reuse gate's evidence, and the
[capability guide](../feature-map/how-to-add-a-capability.md) links the
measured provider-model row to the measurement.
