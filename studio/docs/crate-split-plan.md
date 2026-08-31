# Crate-Split Plan: Slicing the `ticketry` Backend into a Cargo Workspace

**Status:** Phase 1 complete (untangled; `cargo test module_graph` proves the
target slice graph is acyclic). Phase 2 (crate extraction) in progress.
**Scope:** `studio/src-tauri/` Rust backend only. No frontend, GraphQL contract, or runtime behavior changes.
**Goal:** Convert the single ~96k-line `ticketry` crate into a wide workspace of
domain-slice crates so that (a) incremental rebuilds only recompile the slice
that changed plus its dependents, and (b) Cargo/rustc can compile independent
slices in parallel.

---

## 1. Current state (measured 2026-08-31)

### 1.1 Workspace shape

The workspace (`studio/src-tauri/Cargo.toml`) has two members:

| Crate | Size | Role |
| --- | --- | --- |
| `ticketry` (root) | 733 files, ~96,149 lines | Everything: all five bounded contexts, all binaries, all tests |
| `crates/tauri-graphql` | small | async-graphql ↔ Tauri IPC bridge |

Every edit to any of the 733 files re-runs the full crate through type
checking, monomorphization, and linking against Tauri, SeaORM, Seaography,
async-graphql, and axum. Crates are rustc's unit of parallelism — a single
crate's codegen is mostly single-threaded regardless of `codegen-units`.

### 1.2 Module sizes (lines of Rust per top-level module in `src/`)

| Module | Lines | Context-map context |
| --- | ---: | --- |
| `work_management` | 19,011 | Work Management |
| `terminal` | 11,136 | Workspace Runtime |
| `installation` | 10,984 | (installer/classification) |
| `worktree` | 9,671 | Workspace Runtime |
| `runs_persistence` | 7,130 | Agent Execution |
| `documents` | 5,609 | Workspace Runtime |
| `workspace` | 4,014 | Workspace Runtime |
| `execution` | 3,584 | Agent Execution |
| `launch` | 2,819 | Agent Execution / Terminal |
| `settings_persistence` | 2,690 | shared |
| `native_terminal` | 2,647 + 127 (root file) | Desktop Runtime |
| `desktop` | 2,467 | Desktop Runtime |
| `bin` | 2,282 | dev tools |
| `module_links` | 1,687 | Work Management |
| `entities` | 1,201 | shared vocabulary |
| `graph_run_service` | 1,179 | Agent Execution |
| `graphql_foundation` | 1,106 | schema assembly |
| `viewer_ownership` | 859 | Workspace Runtime |
| `tool_discovery` | 834 | shared |
| `tmux_adapter` | 815 + 493 (root file) | Workspace Runtime |
| `hook_spool` | 790 | Agent Execution |
| `diagnostics` | 698 | shared leaf |
| `data_directory` | 620 | shared leaf |
| `temporary_profile` | 454 | Workspace Runtime |
| `runs` | 403 | Agent Execution |
| `app_updates` | 341 | Desktop Runtime |
| `query_root` | 238 + 391 (root file) | schema assembly |

Top five modules hold ~60% of all lines. `entities` — the natural shared
crate — is only 1,201 lines, so the thing everything depends on is cheap.

### 1.3 Why slices, not layers (research summary)

Surveyed: Zed (~339 crates), Deno (~67), rust-analyzer (~38), GitButler (~70),
Meilisearch (21), lldap (~16), Graphite (59), Vaultwarden (1, the
counterexample), plus matklad's "Large Rust Workspaces" / "Fast Rust Builds",
corrode.dev, Rust Project Primer, and the Feldera 1000-crates writeup.

Key conclusions applied here:

- **Split by domain slice**, not technical layer. Zed, Meilisearch, Graphite,
  and GitButler all do this; only rust-analyzer/lldap are layer-split, and for
  API-boundary reasons, not build speed.
- **Graph shape beats crate count.** A layered chain A→B→C→D compiles
  sequentially and buys nothing. A wide diamond — many independent slice
  crates over one small vocabulary crate, converging on a thin bin — is what
  parallelizes (matklad; Feldera measured 16× from crate-level parallelism
  where raising `codegen-units` did nothing).
- **Thin bin crate** is the norm (rust-analyzer doctrine, GitButler, lldap):
  only the top crate knows about the shell (Tauri) and composition.
- **Keep shared crates small and boring** (GitButler `but-core`, Meilisearch
  `meilisearch-types`) — a vocabulary, not a dumping ground.
- **Proc-macro/serde-heavy code goes in leaf crates** — proc-macro deps block
  compiler pipelining for everything downstream.
- **Every file in `tests/` is a separate linked binary.** With deps this heavy,
  link time multiplies; consolidate integration tests per crate.
- **Cheap levers first/alongside:** `[profile.dev]` tuning,
  `split-debuginfo = "unpacked"`, `debug = "line-tables-only"`, a faster
  linker (`rust-lld`), `[profile.dev.package.<heavy>] opt-level = 3`
  (Vaultwarden, Zed, GitButler all do this instead of or before splitting).

### 1.4 The blocker: the module graph is currently cyclic

Cargo forbids cyclic crate dependencies. A grep-based analysis of
`crate::<module>` references (excluding tests and doc comments) found:

- **20 of 27 modules form one strongly-connected component** containing 117 of
  136 cross-module edges. As-is, the crate cannot be split at all.
- **But the tangle is thin.** Nearly every mutual pair is lopsided
  (terminal→launch 32 refs vs launch→terminal 3; entities↔work_management
  27 vs 4; desktop→terminal 16 vs terminal→desktop 1), meaning the minority
  direction is a stray import, not real coupling. ~24 back-edges, concentrated
  in four mechanical refactors, reduce the graph to a DAG.

The full edge list and cycle inventory are reproduced in Appendix A.

---

## 2. Target workspace layout

Flat `crates/` directory (matklad convention: every crate one level deep, root
`Cargo.toml` becomes a virtual manifest or stays as the thin `ticketry` bin
package; crate name == folder name; internal crates versioned `0.0.0`).

```
studio/src-tauri/
├── Cargo.toml                      # workspace root + thin `ticketry` bin package
├── src/main.rs                     # bin only: builds Tauri app from desktop crate
└── crates/
    │  ── shared vocabulary (small, boring, no upward deps) ──
    ├── ticketry-entities/          # ALL SeaORM entities + graphql_scalars
    ├── ticketry-diagnostics/       # current diagnostics/ (leaf, 0 outgoing edges)
    ├── ticketry-data-directory/    # current data_directory/ (leaf)
    ├── ticketry-tool-discovery/    # tool_discovery (depends: data-directory)
    │
    │  ── domain slices (vertical: entities-usage + services + GraphQL registration) ──
    ├── ticketry-settings/          # settings_persistence
    ├── ticketry-runs/              # persistence + graphql + authority
    │                               #   + hook_spool
    ├── ticketry-work-management/   # work_management + module_links
    ├── ticketry-documents/         # documents
    ├── ticketry-workspace-runtime/ # worktree + workspace (merged — genuinely
    │                               #   bidirectional; see §3.4)
    ├── ticketry-launch/            # launch (+ the launch DTOs hoisted from terminal)
    ├── ticketry-terminal/          # terminal + tmux_adapter(+root file) + viewer_ownership
    │                               #   + temporary_profile
    ├── ticketry-agent-execution/   # execution + graph_run_service
    ├── ticketry-mcp/               # mcp (the tool listener; dispatches across slices)
    ├── ticketry-installation/      # installation
    │
    │  ── composition (cross-slice by nature) ──
    ├── ticketry-graphql-schema/    # graphql_foundation + query_root(+root file), merged
    ├── ticketry-desktop/           # desktop + native_terminal(+root file) + app_updates;
    │                               #   ALL #[tauri::command] handlers live here
    ├── ticketry-dev-tools/         # current src/bin/* generation/export/verify binaries
    └── tauri-graphql/              # unchanged (already a crate)
```

### 2.2 Corrections made during Phase 2

- **The Runs slice is `ticketry-runs`, not `ticketry-runs-persistence`.**
  Persistence is one of its four modules — the others are the GraphQL views,
  the run-scoped authority, and the hook spool — and the longer crate name
  would have read `ticketry_runs_persistence::runs_persistence::` at every
  call site. Inside the crate the four modules are named for what they are:
  `persistence`, `graphql`, `authority`, `hook_spool`.
- **Extraction order follows the measured layering, not the original table.**
  The hub (`work-management`) reads `runs`, so `runs` precedes it. The table
  above is renumbered to the order actually being executed.
- **`#[cfg(test)]` helpers used across slices become `test-support`
  features.** `#[cfg(test)]` only ever meant "this crate's own tests"; once
  the caller is a different crate it cannot reach the helper. Each such seam
  ships behind a `test-support` feature that only `[dev-dependencies]`
  enables.
- **`terminal::lifecycle::spool_layout` moved to `hook_spool`.** It is the
  hook spool's own directory layout, and living under terminal was the spool's
  only reference back up into it.

### 2.1 Corrections made during Phase 1

Three groupings in the original §2 could not be built as written. The guard
test in §5.1 is the authority on the current mapping
(`tests/module_graph_support/mod.rs`, `SLICES`):

- **`agent-execution` split in two.** The original crate merged
  `runs_persistence` — which `terminal` reads 27 times — with `execution` and
  `graph_run_service`, which read `terminal` back. No ordering makes that one
  acyclic crate. It is now `runs-persistence` (below terminal) and
  `agent-execution` (above it), matching this document's own measured layering
  in Appendix A.
- **`mcp` is its own slice.** The MCP tool listener lived in
  `work_management::mcp` and dispatched into terminal, execution, graph runs,
  and launch — the single largest source of `work_management` back-edges. It
  is composition, not work-management model code, so it sits above everything
  it dispatches to. `run_authority` (the run-scoped credential store, which
  terminal needs) split out of it and joined `runs-persistence`.
- **`graphql_scalars` joined `entities`.** `StringList` is a Seaography scalar
  six slices need; it lived in `work_management::read_types`, which is why
  `settings` reached up into work management.


Notes on grouping decisions:

- **`worktree` + `workspace` merge** into one crate: their dependency is
  bidirectional in substance (worktree uses workspace error/operation types;
  workspace reads worktree persistence tables from 9 files). Merging is
  cheaper and more honest than inventing a contracts crate for two modules
  that are one context ("Workspace Runtime") anyway. Can be revisited later.
- **`graphql_foundation` + `query_root` merge**: schema assembly calls schema
  definition and back; they are one concern.
- **Small tail modules are folded into their owning slice**, not made
  micro-crates: `runs`/`hook_spool` → agent-execution; `viewer_ownership`/
  `tmux_adapter`/`temporary_profile` → terminal; `module_links` →
  work-management; `app_updates`/`native_terminal` → desktop. A 400-line crate
  is pure overhead.
- **Slices MAY depend on other slices** where the context map says so
  (terminal reads work-management launch policy; agent-execution reads
  work-management dependency/launch policy). The requirement is acyclicity,
  not zero edges. Expected slice-level DAG:

```
entities  diagnostics  data-directory
   ▲            ▲            ▲
   │            │            └── tool-discovery
   ├── settings ├── agent-execution ◄──┐
   ├── work-management ◄───────────────┤ (reads policy)
   ├── documents                       │
   ├── workspace-runtime ──► work-management (5 refs)
   ├── launch ──► work-management, workspace-runtime, settings, documents
   ├── terminal ──► launch, agent-execution, entities, tool-discovery, work-management
   ├── installation ──► work-management, terminal, settings, documents
   └── graphql-schema ──► (registers every slice)
              desktop ──► everything; `ticketry` bin ──► desktop
```

  The heavy parallelism win: `documents`, `settings`, `agent-execution`,
  `work-management`, `installation` largely build concurrently; the serial
  spine is only entities → work-management → terminal → desktop.

---

## 3. Phase 1 — Untangle (no workspace changes yet) — **DONE**

Everything in this phase happens inside the existing single crate. Each step
is independently landable, testable with the standard validation commands, and
makes `lib.rs`'s module graph strictly more acyclic. **Do these as separate
PRs.** Enforce progress with the guard test in §5.1 so broken cycles cannot
silently return.

### 3.1 Hoist `work_management::entities` into `entities/` (keystone move) — done

There are two SeaORM entity namespaces today: `src/entities/**` and
`src/work_management/entities/**`. Cross-slice relation targets point into the
second one, which drags seven modules into cycles with `work_management`.
Confirmed back-edge sites include:

- `entities/execution/graph_run.rs:3` — `use crate::work_management::entities::{issue, project};`
- `entities/runs/agent_run.rs:33` — `pub issue: BelongsTo<crate::work_management::entities::issue::Entity>,`
- `entities/execution/launch_claim.rs:21`, `entities/runs/automation_attempt.rs:26` — same pattern.

Work:
1. Move every module under `src/work_management/entities/` to
   `src/entities/work_management/` (or flatten into `src/entities/` if names
   don't collide — keep SeaORM `table_name` attributes untouched either way).
2. Leave `pub use crate::entities::work_management as entities;` re-export in
   `work_management/mod.rs` temporarily so call sites keep compiling; then
   mechanically rewrite `crate::work_management::entities::` →
   `crate::entities::work_management::` across the tree and delete the
   re-export.
3. Re-run the Seaography generation binaries (`prepare_*_generation_db`) if
   entity module paths are baked into generated registration code; regenerate
   rather than hand-patch, per the repo's generated-contract rules.

Effect: removes the `entities→work_management` back-edge and, with it, the
cycle membership of `entities`, `settings_persistence`, `runs_persistence`,
`documents`, `workspace`, `terminal`, and `launch` versus `work_management`
(their only upward reach was `::entities`).

### 3.2 Move launch DTOs out of `terminal` — done

`launch → terminal` exists only for two request types:

- `launch/authority/service.rs:10`, `launch/authority/sources.rs:10` —
  `use crate::terminal::launch::{CreateTerminalSession, TerminalLaunchKind};`
- `launch/authority/material.rs:1` — `use crate::terminal::launch::CreateTerminalSession;`

Work: move `CreateTerminalSession` and `TerminalLaunchKind` (and anything they
transitively require that is plain data) from `terminal/launch/` into
`launch/` (e.g. `launch/contracts.rs`); `terminal` then imports them from
`launch`. This *inverts* the 3-ref direction and preserves the 32-ref
direction (`terminal → launch`), which matches the intended slice DAG.

### 3.3 Move misplaced Tauri command handlers into `desktop` — done

`terminal → desktop` and `native_terminal → desktop` back-edges are Tauri
state injections inside command handlers that structurally belong to the
shell:

- `terminal/viewer/webview_commands.rs:338` — takes
  `tauri::State<'_, crate::desktop::launch_runtime::DesktopLaunchRuntime>`.
- `native_terminal.rs:62` and `native_terminal/macos/attach_commands.rs:17` —
  same pattern.

Work: relocate these `#[tauri::command]` functions (the whole functions, not
just imports) into `desktop/` (e.g. `desktop/commands/terminal_viewer.rs`,
`desktop/commands/native_terminal_attach.rs`). They may call *into* terminal /
native_terminal public APIs — that direction is fine. Establish the rule going
forward: **`#[tauri::command]` only in the desktop crate** (plus taurpc
procedure definitions), since commands are shell composition by definition.
Update the capability/permission lists in
`capabilities/studio-main.json` if command module paths are referenced there.

### 3.4 Resolve the three genuinely-coupled pairs — done

1. **`workspace ↔ worktree` (15 vs 26 refs, 9 files of workspace reach into
   worktree):** do NOT try to break this with symbol moves. Decision: they
   ship together in one `ticketry-workspace-runtime` crate. In this phase,
   nothing to do beyond noting the merge in the plan.
   - Back-edge examples for the record: `worktree/discard/error.rs:14` and
     `worktree/discard/service.rs:29` use
     `crate::workspace::operations::{WorkspaceOperationError, WorkspaceOperationErrorCode}`;
     `workspace/handoff/manifest.rs:78,83` read
     `crate::worktree::persistence::{ADOPTED_TABLE, LEDGER_TABLE}`.
2. **`graphql_foundation ↔ query_root` (6 vs 3):** one crate. In this phase,
   optionally move `query_root.rs` + `query_root/` under `graphql_foundation/`
   so the later extraction is a pure directory move.
   - Sites: `graphql_foundation/mod.rs:41,63,113` call
     `crate::query_root::foundation_schema_with_terminal_services`;
     `query_root.rs:11,186,380` call back into
     `graphql_foundation::{error, entity_registration, readiness_gate}`.
3. **`work_management`'s remaining upward reaches** (into `query_root`,
   `graphql_foundation`, `terminal` (17 refs), `graph_run_service` (7),
   `execution` (3), `runs_persistence` (5), `settings_persistence` (6),
   `diagnostics` (18 — fine, diagnostics is a leaf)): audit each. Expected
   outcomes:
   - refs into `query_root`/`graphql_foundation`: schema/registration code
     that belongs in the future `graphql-schema` crate → move those functions
     there (they can depend on work_management).
   - refs into `terminal`/`execution`/`graph_run_service`: either launch-
     binding types that belong in `launch`/`entities`, or orchestration that
     belongs above work_management (desktop or the owning slice). Move code,
     don't add abstractions, wherever possible; introduce a trait in
     work_management implemented by the upper slice ONLY if code motion is
     impossible.
   - `work_management ↔ settings_persistence` (7 vs 6, genuinely mutual):
     likely shared types → hoist the shared structs into `entities` (if they
     are persistence-shaped) and keep one direction.

### 3.5 Clean the freebies — done

- Delete/inline edges that exist **only in doc comments** (`entities→documents`,
  `entities→worktree`, `entities→workspace`, `entities→module_links`,
  `worktree→query_root`, `settings_persistence→module_links`) — rewrite the
  doc links as plain text or relative doc paths.
- Edges that exist **only in test files** (`hook_spool→terminal`, parts of
  `work_management→query_root`, `terminal→tmux_adapter`): move those tests to
  the crate that owns the higher module, or to `tests/` integration tests, so
  they don't constrain the split.
- `temporary_profile` has zero inbound edges — it can be extracted at any
  time with no coordination.

**Exit criterion for Phase 1: met.** `ALLOWED_BACK_EDGES` in
`tests/module_graph_support/mod.rs` is empty and
`cargo test --test module_graph` passes, so the target slice graph is a DAG.
Every step exported the foundation SDL and diffed it against the pre-Phase-1
baseline; the diff was empty throughout, and no test that passed before a step
failed after it.

The §3.4 work landed as: launch delivery and the merge-preparation adapter
moved up into `execution`; the MCP listener moved out of work management
(§2.1); `final_schema_migrations` moved to `installation`; `StringList` moved
to `graphql_scalars`; settings stopped importing a work-management migration
ledger constant; `documents::save` and the gated directory-completion query
moved into `workspace`.

---

## 4. Phase 2 — Extract crates (bottom-up) — **IN PROGRESS**

Extract in dependency order so every extraction lands against an
already-extracted substrate. After each step: `cargo build`, `cargo test`,
`npm run typecheck`, `npm run test --workspace @worktracker/studio`, and boot
`npm run desktop:dev` once.

Per-crate mechanics (same every time):

1. `mkdir crates/ticketry-<slice>` with `Cargo.toml`
   (`version = "0.0.0"`, `publish = false`, `edition = "2021"`), add to
   `[workspace.members]`.
2. `git mv src/<module> crates/ticketry-<slice>/src/` (preserve history),
   create `lib.rs` re-exporting the old module structure
   (`pub mod <module>;` or flattened), so downstream `use` paths change
   mechanically from `crate::<module>::` to `ticketry_<slice>::`.
3. Move the module's dependencies from the root `Cargo.toml` into the new
   crate; promote anything used by ≥2 crates into `[workspace.dependencies]`
   (the workspace-dep table already exists — extend it; keep the `=x.y.z`
   pinning convention).
4. Move the module's `#[cfg(test)]` tests with it. Integration tests in
   `tests/` that only exercise this slice move to
   `crates/ticketry-<slice>/tests/` — as **one** test binary per crate
   (single `tests/it.rs` with `mod` includes), per the link-time rule.
5. In the root crate, replace `mod <module>;` with
   `pub use ticketry_<slice> as <module>;` temporarily; delete after all
   internal callers are rewritten.

Extraction order:

| Step | Crate | Why this order |
| --- | --- | --- |
| 2.1 | `ticketry-diagnostics`, `ticketry-data-directory` | **DONE.** Leaves, zero outgoing edges; proves the pipeline |
| 2.2 | `ticketry-entities` | **DONE.** Post-§3.1 it's a leaf; unblocks everything. SeaORM/seaography deps move here, `graphql_scalars` with them |
| 2.3 | `ticketry-tool-discovery`, `ticketry-settings` | **DONE.** One dep each |
| 2.4 | `ticketry-runs` | **DONE.** Below terminal; work-management reads it, so it precedes the hub |
| 2.5 | `ticketry-work-management` (incl. `module_links`) | The hub; largest single win. Its Seaography registration hooks stay with it; schema *assembly* does not |
| 2.6 | `ticketry-documents`, `ticketry-agent-execution` | Parallel siblings over entities/work-management |
| 2.7 | `ticketry-workspace-runtime` (worktree+workspace merged) | Needs work-management |
| 2.8 | `ticketry-launch` | Needs workspace-runtime, work-management, settings, documents |
| 2.9 | `ticketry-terminal` (incl. tmux_adapter, viewer_ownership, temporary_profile) | Needs launch, agent-execution |
| 2.10 | `ticketry-installation`, `ticketry-mcp` | Need terminal, work-management |
| 2.11 | `ticketry-graphql-schema` (graphql_foundation + query_root) | Registers all slices; depends on all of them + tauri-graphql |
| 2.12 | `ticketry-desktop` (desktop + native_terminal + app_updates) | Composition root: all `tauri::command`s, taurpc router, plugin setup, `tauri::Builder` |
| 2.13 | `ticketry-dev-tools` | All `src/bin/*` dev binaries move here behind their existing `development-tools` feature; the `required-features` gymnastics in the root manifest disappear |
| 2.14 | Slim the root | Root `ticketry` package keeps only `main.rs` (+ the `staticlib`/`cdylib` lib target if the mobile/native embedding needs it) delegating to `ticketry-desktop::run()`. `build.rs`/`tauri-build` stays at the root with `tauri.conf.json` |

Special handling:

- **`build.rs` / `cc`:** the root `build.rs` compiles native code (`cc`) and
  runs `tauri-build`. Audit which native sources belong to `native_terminal`
  (libghostty glue) — if so, that `cc` invocation moves to
  `ticketry-desktop`'s (or a dedicated `ticketry-native-terminal-sys`)
  `build.rs`; `tauri-build` must stay in the crate that owns
  `tauri.conf.json` (the root bin).
- **Features:** `desktop-acceptance` (wdio plugin) and `native-libghostty`
  belong to `ticketry-desktop`; `development-tools` becomes simply "the
  dev-tools crate exists" — root forwards
  `development-tools = ["dep:ticketry-dev-tools"]`-style only if the bin
  entry points must remain in the root package for tooling reasons; otherwise
  binaries live in `ticketry-dev-tools` directly and scripts
  (`studio/scripts/release-build.mjs`, npm scripts invoking
  `cargo run --bin ...`) are updated with `-p ticketry-dev-tools`.
- **`tests/common/` fixtures** (`execution_authorization.rs`,
  `runs_status_fixture.rs`, …): become `ticketry-testsupport`
  (dev-dependency only, GitButler `but-testsupport` pattern) if used by ≥2
  crates' tests; otherwise move with their single consumer.
- **Seaography generation binaries** write generated entity/registration
  code — confirm their output paths track the moved entity locations and
  re-run them once after 2.2; commit regenerated output as-is.

---

## 5. Guardrails, validation, and follow-through

### 5.1 Cycle guard test (add FIRST, before any Phase-1 PR)

Add a test (root crate, later `ticketry-desktop` or CI script) that parses
`use crate::…` / `crate::…::` references per top-level module (the repo
already dev-depends on `syn` with `visit` — use it rather than regex), builds
the module digraph, and asserts:

1. No cycles among the modules already untangled (maintained allowlist of
   not-yet-fixed back-edges that only ever shrinks).
2. After Phase 2 starts: `#[tauri::command]` appears only under
   `desktop`/`ticketry-desktop` (grep-based assertion).

This is the "test preventing the deviation from spreading" required by the
repo's governing rules, applied to architecture.

### 5.2 Validation battery (every PR)

```bash
npm run typecheck
npm run test --workspace @worktracker/studio
npm run build --workspace @worktracker/studio
cargo test            # in studio/src-tauri, all workspace members
npm run desktop:dev   # boot smoke-check
```

Plus once per phase: the Playwright e2e suite (`/e2e` skill) since the
GraphQL surface must be byte-identical — export the SDL
(`export_foundation_schema`) before Phase 1 and diff it after every step; the
SDL diff must be empty throughout.

### 5.3 Measure, before and after

Run and save `cargo build --timings` (clean + warm single-file-touch in
`terminal` and in `work_management`) before Phase 1, after Phase 1, and after
Phase 2. The warm numbers are the success metric. If Phase-1 measurement shows
link time dominates, also apply the cheap levers immediately (they compound
with the split):

```toml
[profile.dev]
split-debuginfo = "unpacked"   # macOS: skip dSYM packing
debug = "line-tables-only"

[profile.dev.package."*"]      # or targeted: sea-orm, seaography, tauri, syn
opt-level = 1                  # measure; Zed/GitButler use targeted opt-level = 3
```

and evaluate `rust-lld` (`-C link-arg=-fuse-ld=lld` via `.cargo/config.toml`)
on this macOS toolchain.

### 5.4 Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Generated Seaography code hard-codes module paths | Regenerate via the `prepare_*_generation_db` binaries; never hand-patch (repo rule) |
| Hidden cycles appear during extraction (grep undercounts, e.g. macro-generated paths) | Extraction order is bottom-up, so cycles surface as compile errors at the offending step, scoped to one slice; fix by code motion per §3.4 rules |
| `workspace ↔ worktree` merge hides a real boundary | Acceptable: they are one bounded context ("Workspace Runtime"). Revisit only if the merged crate becomes the rebuild bottleneck |
| Release pipeline breaks (`release-build.mjs`, manifest, updater) | Root package name, bin name `ticketry`, `tauri.conf.json`, and `staticlib`/`cdylib` lib target are preserved at the root; scripts reviewed at step 2.13 |
| PR churn conflicts with feature work | Each step is small, mechanical, and lands independently; `git mv` preserves blame; slices extract one at a time |
| Version/feature drift across member crates | All shared deps go through `[workspace.dependencies]` with the existing `=x.y.z` pins; consider `cargo-hakari` later if dep-feature unification thrash shows up in timings |

### 5.5 Explicit non-goals

- No change to the GraphQL SDL, MCP surface, taurpc procedures, or frontend.
- No new abstraction layers, DAOs, repositories, or trait indirection beyond
  the minimal cases in §3.4 — this is code *motion*, not redesign.
- No micro-crates: nothing under ~800 lines gets its own crate unless it is a
  true leaf already (diagnostics, data_directory).
- Not chasing clean-build time; the target is warm incremental rebuild time
  and parallelism.

---

## Appendix A — Measured module dependency data (2026-08-31)

Code-only references (`use crate::X` / `crate::X::`), tests and doc comments
excluded. Format: `module -> dependency(count)`.

```
desktop             -> terminal(16) diagnostics(9) launch(8) work_management(6) settings_persistence(4)
                       graphql_foundation(4) execution(4) native_terminal(3) hook_spool(3) documents(3)
                       data_directory(3) workspace(2) runs_persistence(2) worktree(1) viewer_ownership(1)
                       tool_discovery(1) module_links(1) app_updates(1)
query_root          -> work_management(15) terminal(13) worktree(10) entities(10) documents(9)
                       settings_persistence(6) workspace(4) runs_persistence(3) graphql_foundation(3)
                       graph_run_service(3) execution(3) viewer_ownership(2) runs(1) module_links(1)
graphql_foundation  -> terminal(12) documents(10) work_management(9) runs_persistence(9)
                       settings_persistence(8) workspace(6) query_root(6) worktree(5) viewer_ownership(4)
                       installation(3) execution(3) entities(3) module_links(1) launch(1)
terminal            -> entities(43) launch(32) runs_persistence(27) tmux_adapter(15) viewer_ownership(6)
                       tool_discovery(5) work_management(4) documents(3) worktree(2) hook_spool(2) desktop(1)
work_management     -> entities(27) diagnostics(18) terminal(17) graph_run_service(7) settings_persistence(6)
                       runs_persistence(5) query_root(5) graphql_foundation(5) execution(3) worktree(2)
                       launch(2) module_links(1) data_directory(1)
worktree            -> workspace(26) entities(24) runs_persistence(7) work_management(5) terminal(2)
                       module_links(2) data_directory(1)
installation        -> work_management(14) settings_persistence(6) terminal(4) tmux_adapter(3) worktree(2)
                       documents(2) runs_persistence(1) module_links(1) execution(1) data_directory(1)
documents           -> entities(15) workspace(11) work_management(1) runs_persistence(1) module_links(1)
workspace           -> worktree(15) documents(9) entities(3) work_management(1)
execution           -> entities(9) work_management(7) graph_run_service(5) terminal(4)
graph_run_service   -> execution(7) entities(6) terminal(3) work_management(2) launch(2) runs_persistence(1)
launch              -> entities(6) worktree(4) work_management(4) terminal(3) settings_persistence(2)
                       documents(2) module_links(1)
runs                -> runs_persistence(15)
runs_persistence    -> diagnostics(14) entities(2) work_management(1)
settings_persistence-> work_management(7) entities(1)
module_links        -> work_management(3) settings_persistence(3) launch(2) entities(2)
native_terminal     -> viewer_ownership(3) terminal(3) desktop(2)
viewer_ownership    -> entities(3) tmux_adapter(1)
temporary_profile   -> work_management(1) tmux_adapter(1) terminal(1) entities(1)
hook_spool          -> runs_persistence(2)
tmux_adapter        -> tool_discovery(2)
tool_discovery      -> data_directory(2)
entities            -> work_management(4)
app_updates         -> (none)
data_directory      -> (none)
diagnostics         -> (none)
```

Strongly-connected component (20 modules; 117/136 edges internal):
desktop, documents, entities, execution, graph_run_service,
graphql_foundation, hook_spool, installation, launch, module_links,
native_terminal, query_root, runs, runs_persistence, settings_persistence,
terminal, viewer_ownership, work_management, workspace, worktree.

Mutual pairs (refs each way):

```
desktop <-> native_terminal          3 / 2
desktop <-> terminal                16 / 1
documents <-> workspace             11 / 9
entities <-> work_management         4 / 27
execution <-> graph_run_service      5 / 7
execution <-> work_management        7 / 3
graph_run_service <-> work_management  2 / 7
graphql_foundation <-> query_root    6 / 3
graphql_foundation <-> work_management 9 / 5
launch <-> module_links              1 / 2
launch <-> terminal                  3 / 32
launch <-> work_management           4 / 2
module_links <-> work_management     3 / 1
query_root <-> work_management      15 / 5
runs_persistence <-> work_management 1 / 5
settings_persistence <-> work_management 7 / 6
terminal <-> work_management         4 / 17
terminal <-> worktree                2 / 2
work_management <-> worktree         2 / 5
workspace <-> worktree              15 / 26
```

Post-untangle topological layering (L0 = deepest):
L0 `entities, diagnostics, data_directory, app_updates` ·
L1 `runs_persistence, tool_discovery, settings_persistence` ·
L2 `tmux_adapter, hook_spool, module_links, runs, viewer_ownership` ·
L3 `work_management, documents` · L4–5 `workspace, worktree` ·
L6–7 `launch, terminal` · L8–9 `graph_run_service, execution, temporary_profile` ·
L10–11 `installation, graphql_foundation+query_root` · L12 `desktop`.

## Appendix B — Research sources

- matklad, *Large Rust Workspaces* — flat `crates/`, virtual root manifest, `0.0.0` versions.
- matklad, *Fast Rust Builds* — graph width over crate count; minimize linked binaries; push proc macros/serde to leaves; thin generic wrappers.
- corrode.dev, *Tips For Faster Rust Compile Times* — workspace splitting for incremental locality; cargo-hakari.
- Rust Project Primer, *Workspace* — when NOT to split; Tokio re-merge precedent; no circular deps as the gating constraint.
- Feldera, *30 to 2 minutes with one thousand crates* — crates (not codegen-units) are the parallelism unit; 16× on 64 cores.
- Repos inspected: Zed (~339 crates, domain+suffix convention, per-vendor/platform leaf crates), Deno (~67, libs/ext/runtime/cli tiers, thin `cli` over `cli/lib`), rust-analyzer (~38, strict layer doctrine, bin crate owns all LSP/JSON), GitButler (~70, `but-*` domain crates, one `but-api` shared by Tauri/CLI/server/Node frontends, thin `gitbutler-tauri`), Meilisearch (21, subsystem crates + `meilisearch-types`), lldap (SeaORM+GraphQL, ports-and-adapters split, semi-thin `server`), Graphite (59, feature crates; PR #3384 explicitly for incremental compile times), Vaultwarden (single crate; compile time via profiles/llvm-lines/rust-lld instead).
