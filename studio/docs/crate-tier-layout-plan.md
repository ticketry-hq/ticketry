# Crate tier layout — move plan

Reorganize the 18 flat crates under `studio/src-tauri/crates/` into six
functional tiers. No crate is created, merged, split, or renamed; no `lib.rs`
boundary or dependency edge changes. This is a pure relocation plus one new
contract test that makes the tier ordering enforceable.

## Target layout

```
studio/src-tauri/crates/
├── foundation/     # cross-cutting plumbing, zero workspace deps
│   ├── ticketry-entities/
│   ├── ticketry-data-directory/
│   ├── ticketry-diagnostics/
│   └── tauri-graphql/
├── config/         # application configuration
│   └── ticketry-settings/
├── worktracking/   # the record of work: items, documents, runs
│   ├── ticketry-work-management/
│   ├── ticketry-documents/
│   └── ticketry-runs/
├── execution/      # the act of running work: worktrees, launch, terminals
│   ├── ticketry-tool-discovery/
│   ├── ticketry-workspace-runtime/
│   ├── ticketry-launch/
│   ├── ticketry-terminal/
│   ├── ticketry-agent-execution/
│   └── ticketry-installation/
├── surfaces/       # external boundaries; no edges between them
│   ├── ticketry-graphql-schema/
│   └── ticketry-mcp/
└── app/            # binaries composing everything
    ├── ticketry-desktop/
    └── ticketry-dev-tools/
```

## Layering invariant

Tier ranks: `foundation(0) < config(1) < worktracking(2) < execution(3) <
surfaces(4) < app(5)`. Every cross-tier dependency must point to a strictly
lower tier; within-tier dependencies are allowed. Verified against the current
`Cargo.toml` graph: today's edges pass with zero exceptions.

Load-bearing classifications (do not second-guess during the move):

- `ticketry-runs` is **worktracking** (the record of runs), not execution.
  This is what makes the ordering acyclic: `work-management → runs` and
  `terminal → work-management` would otherwise point across tiers both ways.
- `ticketry-installation` is **execution**, because `graphql-schema` depends
  on it; placing it in surfaces would create a surface→surface edge.
- `ticketry-tool-discovery` is **execution** (discovers installed agent tools
  for launch/terminal), though its deps would also permit foundation.
- Watch-item the contract test must hold forever: `work-management` never
  grows a dependency on any execution crate.

## Phase 0 — preconditions

1. Start from a clean tree on `work/divide-creates`; record `git rev-parse HEAD`.
2. Baseline: `cargo check --workspace` and `cargo test --workspace` from
   `studio/src-tauri` must pass before any move, so post-move failures are
   attributable to the move.

## Phase 1 — move the crate directories

One `git mv` per crate into its tier directory (18 moves), exactly per the
target layout above. No file contents change in this phase.

## Phase 2 — workspace `Cargo.toml` (`studio/src-tauri/Cargo.toml`)

1. `[workspace] members`: replace the 18 explicit `crates/<name>` entries with
   the glob `"crates/*/*"` (keep `"."`). The glob keeps the members list from
   ever drifting from the directory layout again.
2. `[workspace.dependencies]`: update all 18 `path = "crates/<name>"` entries
   to `path = "crates/<tier>/<name>"` (lines ~131–150). These cannot be
   globbed; each is an explicit edit.

No member crate's own `Cargo.toml` references a sibling by path (all use
`.workspace = true`), so nothing else in Cargo metadata changes.

## Phase 3 — hard-coded `crates/...` path strings

Every literal path that names a crate directory, found by
`grep -rn "crates/ticketry\|crates/tauri"` (excluding target/):

| File | What to update |
| --- | --- |
| `studio/src-tauri/tests/module_links.rs:622,626,654` | fixture paths into `ticketry-installation` and `ticketry-work-management` |
| `studio/src-tauri/tests/installation_classification.rs:84` | path inside an error-message string |
| `studio/src-tauri/tests/startup_compaction_schedule.rs:193` | path into `ticketry-desktop` |
| `studio/src-tauri/tests/graphql_view_registration_contract.rs:248–272` | the allowlist of `crates/...` source paths |
| `studio/src-tauri/tests/common/execution_legacy_fixture.rs:34,36` | `include_str!("../../crates/ticketry-installation/...")` — compile-time; breaks loudly if missed |
| `studio/src-tauri/crates/.../ticketry-terminal/src/terminal/persistence/aggregate_seaography_audit.rs:189,193` | self-referencing audit paths |
| `studio/src-tauri/crates/.../ticketry-terminal/src/terminal/persistence/child_seaography_handoffs.rs` | same pattern |

After editing, re-run the grep and require every remaining hit to use the new
`crates/<tier>/<name>` form (or be a historical doc, see Phase 5).

## Phase 4 — audit directory-walking tests for depth assumptions

Some tests scan `crates/` rather than naming paths. A scanner that assumes
`crates/<name>/src` (one level) silently skips `crates/<tier>/<name>/src`
(two levels) — the dangerous failure mode is a contract test that passes
because it now checks nothing.

1. Known scanner: `studio/src-tauri/tests/tmux_session_naming.rs` (its doc
   comment says it scans crates to cover `ticketry-terminal`).
2. Find the rest: grep the root-package `tests/` and crate test code for
   `read_dir`, `walkdir`, `glob`, and `crates` joins; fix each to either
   recurse or glob two levels.
3. For every fixed scanner, assert non-emptiness (it found at least the
   expected crates) so a future layout change fails loudly instead of
   hollowing the test out.

## Phase 5 — add the tier contract test

New root-package test `studio/src-tauri/tests/crate_tier_layout.rs`:

1. Walk `crates/*/*/Cargo.toml`; derive each package's tier from its parent
   directory name; fail on any directory outside the six known tiers.
2. Assert the package set is exactly the 18 known crates (catches strays and
   silent drops from the members glob).
3. For each crate, parse its `[dependencies]`/`[dev-dependencies]` for
   workspace-internal names and assert `rank(dep) <= rank(crate)`, with
   cross-tier edges strictly `<`.
4. No grandfathered exceptions list — the current graph passes clean.

## Phase 6 — documentation

1. `CLAUDE.md` (worktree copy) and `AGENTS.md`: extend the "Rust service
   layout" bullet with the six tiers and the downward-only dependency rule.
2. `studio/src-tauri/CONTEXT.md`: update the crate map.
3. `README.md`: update if it names crate paths.
4. Leave historical documents (`studio/docs/crate-split-plan.md`,
   `rust-migration/*.md`) untouched; they describe past states. This plan file
   documents the new layout going forward.

## Phase 7 — verification

From the repository root, in order:

1. `cargo check --workspace` (in `studio/src-tauri`) — catches Cargo path and
   `include_str!` mistakes.
2. `cargo test --workspace` — exercises the path-literal tests, the fixed
   scanners, and the new tier test.
3. `npm run typecheck`
4. `npm run test --workspace @worktracker/studio`
5. `npm run build --workspace @worktracker/studio`
6. Final sweep: `grep -rn "crates/ticketry\|crates/tauri-graphql"` shows only
   tiered paths and historical docs.

## Commit and rollback

- Land as **one commit** containing only this relocation (moves, path fixes,
  tier test, doc updates) so `git log --follow` stays clean and revert is a
  single `git revert`.
- The untracked `docs/rust-public-api-explorer.html` in the worktree is
  unrelated; leave it out of the commit.
- Rollback: revert the commit; there is no data or generated-contract impact.
