# Ticketry feature map

This is Ticketry's behavior inventory for agents and regression checklist for
humans. Start here before changing or verifying a feature, then follow the
full-sweep order below. Entries connect production entry points to observable
results, existing coverage and source. Entries follow the complete sweep order
below; every code area is mapped or deliberately excluded with a reason.

## Baseline preconditions

- **Browser:** use the canonical frontend plus Rust GraphQL adapter. For test
  writes, run `bun run web -- --temp-sqlite`, or use
  `bun run --cwd studio test:e2e`, whose Playwright configuration starts its own
  temporary SQLite stack and private tmux server. The ordinary web launcher can
  use product data; do not use that profile for test writes. See
  [web acceptance](../../studio/e2e/README.md),
  [Playwright configuration](../../studio/playwright.config.ts) and
  [web launcher](../../scripts/web-dev.mjs). Default interactive frontend port
  is 5174; Playwright uses 4173. Adapter ports can be configured; read the
  launch output instead of assuming a legacy backend port.
- **Desktop:** `bun run desktop:dev` uses isolated development data by default;
  `bun run desktop:dev -- --temp-sqlite` supplies a fresh disposable profile.
  Alternatively, `bun run --cwd studio test:e2e:desktop` owns an isolated
  installation, disposable provider and private tmux. See the
  [desktop harness](../../studio/e2e-desktop/README.md).
- Complete provider onboarding unless the entry explicitly tests first run.
  Use disposable fixtures rather than paid providers for automated checks.
- Prefer stable test IDs and accessible names to CSS classes. Wait for
  observable end states, not fixed sleeps.
- Never use live application or existing development data for test writes.

## Proof and skip-reporting rules

Drive the production user path and every reachable entry point affected by a
change. Cover success, cancel, error, empty and persistence paths where they
apply. Verify side effects through authoritative GraphQL state, reload or
restart round-trips as well as visible feedback. Report the surface, command,
observed result and evidence; a source citation describes behavior but does
not prove it ran.

Name each unreachable path and its blocker (OS, native driver, hardware, paid
provider or build flag), then cover the closest real reachable path. Browser
evidence cannot establish native libghostty rendering or native tmux terminal
retention; distinguish browser-shell tmux coverage from native rendering and
do not claim paid-provider execution from a fixture. Entries label source-only
coverage and unverified claims explicitly. New behavioral tests belong to
CODING-2685; this campaign adds structural checks only.

## Full-sweep order

### Startup and chrome

- [Startup and service health](startup-and-service-health.md): readiness gates, recovery and reload.
- [Onboarding](onboarding.md): provider setup, first module, tour and Story guidance.
- [Shell layout and footer](shell-layout-and-footer.md): pane layout, footer controls and feedback hosts.
- [Keyboard navigation and shortcuts](keyboard-navigation-and-shortcuts.md): contexts, zones, tab cycling and configurable bindings.

### Projects and modules

- [Projects](projects.md): default project, retained lifecycle contracts and project selection limits.

- [Module Manager](module-manager.md): module groups, search, explicit visibility actions, creation and ordering.
- [Module tabs](module-tabs.md): tab strip, picker, jump badges, presentation visibility and sprint filtering.
- [Module folders and trust](module-folders-and-trust.md): folder links, validation, provider trust and safe retries.

### Work items

- [Stories list](stories-list.md): tree, inline creation, ordering, search, filters and state groups.
- [Ticket details](ticket-details.md): properties, hierarchy, blockers, attachments, deletion and update modals.
- [Descriptions and documents](descriptions-and-documents.md): Markdown, drafts, autosave, document viewers and scratch workspaces.
- [Review findings](review-findings.md): finding locations, workflow states, queued counts and cancellation.
- [Ticket workspace tabs](ticket-workspace-tabs.md): details, terminals, documents, dormant tabs, ordering and keyboard navigation.

### Agents and terminals

- [Agent launch](agent-launch.md): Run item, normal run, Run now, prompt launches and instant changes.
- [Agent lifecycle and status](agent-lifecycle-and-status.md): badges, delivery, retry, startup attention and status reconnection.
- [Ticket terminals](ticket-terminals.md): native and browser renderers, retained viewers, reclaim and terminal durability.
- [Module terminal panel](module-terminal-panel.md): shell tabs, lifecycle actions, panel sizing and keyboard cycling.
- [Conversations](conversations.md): instant launch, composer, rename and conversation terminal.
- [Worktrees and changes](worktrees-and-changes.md): checkout selection, branch inspection, files, diffs and patches.
- [Dependency-graph runs](dependency-graph-runs.md): persisted parallel/serial campaigns and factual planning reads.

### Plan and sprints

- [Plan workspace navigation](plan-workspace-navigation.md): Plan and Sprints entry, retained visits and keyboard navigation.
- [Sprint lifecycle and goals](sprint-lifecycle-and-goals.md): goals, start, complete, carryover and committed-identity recovery.
- [Epic planning](epic-planning.md): epic selection, visits, creation and grouped review.
- [Inline Story creation in Plan](inline-story-creation-in-plan.md): separate drafts, assignment and creation recovery.
- [Story moves](story-moves.md): buttons, keyboard, drag, Retry, Undo and completed-sprint eligibility.
- [Suggestion review](suggestion-review.md): approval, dismissal, proposal editing, Undo and refreshed results.
- [Background discovery and recovery](background-discovery-and-recovery.md): typed provider runs, publication, cancellation and status recovery.

### Settings and configuration

- [Settings](settings.md): settings sections, model configuration, instant launch defaults and change ledger.
- [Workflows and issue types](workflows-and-issue-types.md): type and state catalogs, transitions, agent permissions and launch policy.

### Desktop and system

- [App updates](app-updates.md): launch checks, availability, download progress and update settings.
- [Crash reports and diagnostics](crash-reports-and-diagnostics.md): Dirty Shutdown collection, local reports, notices and runtime logs.
- [Native terminal input and shortcuts](native-terminal-input-and-shortcuts.md): AppKit chord routing, Shift+Enter bytes and WebView composition.
- [Launchkey MIDI control](launchkey-midi-control.md): run-pad projection, input actions, startup and hardware resilience.
- [Voice transcription](voice-transcription.md): Launchkey Record invokes the external Handy transcription toggle.

### Agent-facing services (MCP and hooks)

- [MCP server and tools](mcp-server-and-tools.md): socket ownership, provider stdio bridge, scoped tools and state readback.
- [Hook runner and lifecycle reporting](hook-runner-and-lifecycle-reporting.md): packaged hook runner, spool delivery and lifecycle ingestion.

### Multi-surface journeys

- [Multi-surface journeys](multi-surface-journeys.md): project-to-agent persistence, sprint-filtered tab restore, description isolation and terminal retention.

## Exclusions

| Code area | Reason |
| --- | --- |
| `studio/src/features/conversations/prototype` | Development-only design preview selected by `conversation-design=list`, `inbox` or `timeline`; production builds return no variant and expose no normal entry point. |
| `studio/src/shared` | Cross-feature plumbing; observable behavior is described by consuming entries. |
| `studio/src/runtime` | Browser/desktop adapters; consuming entries and desktop/system describe their user-facing effects. |
| `studio/src/state` | Minimal application-state plumbing, not a separate product surface. |
| `studio/src/app/styles` | Styling assets, not an independent interaction area. |
| `studio/src/app/__tests__` | Test implementation, not a production shell area. |
| `studio/src/graphql-foundation/generated` | Generated GraphQL contracts, not a standalone user feature. |
| `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/window_menu.rs` | Standard OS/Tauri application menu, outside the authored Studio feature inventory. Its removal of Close Window supports the mapped native `close-tab` route; other stock menu actions have no dedicated Ticketry acceptance journey. |
| `studio/src-tauri/native/libghostty_runtime.m` | Native pasteboard copy/paste and clipboard-confirmation callbacks are renderer facilities outside the Studio chord map. Real clipboard contents, multiline paste and terminal-initiated clipboard access have no dedicated installed-desktop acceptance journey; manual coverage remains a gap. |
| `studio/src/app/startup/suppressNativeContextMenu.ts` | Desktop background/read-only context-menu suppression preserves editable-field menus. This native menu policy is outside the startup recovery map; source/unit coverage exists in `studio/src/app/startup/suppressNativeContextMenu.test.ts` (`bun run --cwd studio test -- src/app/startup/suppressNativeContextMenu.test.ts`), but actual OS menu behavior has no desktop acceptance journey. |

Empty leftover folders are ignored; they do not represent a product area.

## Entry contract

Each purpose-named kebab-case Markdown file has one H1, a one-sentence summary,
a `Surfaces:` line listing `browser`, `desktop` and/or `manual`, and directly
after it an `Editions:` line (see [Editions](#editions)), followed by these
seven required non-empty H2 sections in order. The optional
**End-to-end suite** H2 belongs directly after **Verifying it** and before
**Relevant code**; the structural checker accepts it now, and the final
feature-suite migration gate will require it:

1. **Sub-features:** bullets beginning with stable, globally unique kebab-case IDs.
2. **How to get to it:** production user entry points; name keymap actions and default chords.
3. **Prerequisites:** state required beyond the baseline above.
4. **Expected behavior:** applicable success, cancel, error, empty and persistence paths.
5. **Verifying it:** observable selectors/state, existing automated coverage and narrow commands; identify source-only or absent coverage.
6. **Relevant code:** repository-relative source paths; prefer folders when the whole folder is relevant.
7. **Gotchas:** timing, gating, focus, surface limitations and stale references.

Every behavior claim must be grounded in source or an existing test. Record
ungrounded claims as unverified in Gotchas. Put repository-relative source and
test paths in backticks, and use Markdown links relative to the entry file.
An explicit area-folder citation in Relevant code claims coverage of that
area; individual implementation-file citations are pointers, not a claim that
the entire owning domain is mapped.
The local Planning skill is retired. Planning entries preserve
their sub-feature IDs, case IDs and selection tags.

The Studio contract test checks index/file agreement, entry structure, unique
IDs, code-area coverage, cited paths, Playwright spec coverage and relative
links. Every code area must be mapped or excluded with a reason, and every
Playwright spec must be referenced by an entry.
Plain `Suite: studio/e2e/features/<feature-id>.spec.ts` declarations in
**End-to-end suite** also count as browser-spec citations and must point to
existing files. They do not claim code-area ownership; the independent suite
drift check still validates suite identity and coverage tables.

## Editions

Each build compiles one edition, chosen by `TICKETRY_EDITION`: `pocock` is the
default and `core` adds the capabilities in
[`config/editions.json`](../../config/editions.json). Every entry declares the
editions it exists in on the line directly after `Surfaces:`:

- `Editions: pocock, core`: the feature exists in both editions.
- `Editions: core`: the whole feature is core-only. Plan workspace navigation,
  Sprint lifecycle and goals, Epic planning, Inline Story creation in Plan,
  Story moves, Suggestion review, Background discovery and recovery, Launchkey
  MIDI control and Voice transcription are core-only.
- `Editions: pocock`: the feature exists only in Pocock.

A core-only sub-feature inside an entry that also ships in Pocock is marked by
`(core)` directly after its identifier, for example
`` - `dependency-graph-parallel-run` (core): … ``. Every browser case that
exists only in core carries the Playwright tag `@edition-core`, on the case
(`{ tag: ["@case-<id>", "@edition-core"] }`) or on an enclosing
`test.describe`. `@edition-core` is the only edition tag.

The drift check (rule 10) requires one legal `Editions:` line per entry and
keeps tags and markers aligned:

- `@edition-core` cases and `(core)` sub-features appear only in entries whose
  `Editions:` include `core`.
- Every coverage row that cites an `@edition-core` case is a `(core)`
  sub-feature.
- In an entry that also ships in Pocock, a case cited only by `(core)` rows
  carries `@edition-core`.

## End-to-end suite contract

Feature identity is the entry filename without `.md`. Each feature suite lives
at `studio/e2e/features/<feature-id>.spec.ts`; no hand-maintained registry is
created. The entry's **End-to-end suite** section has exactly one `Suite:` line:

- `Suite: studio/e2e/features/<feature-id>.spec.ts`
- `Suite: excluded (manual): <reason>`
- `Suite: excluded (desktop-only): <reason>`

Excluded entries have no suite file or coverage table. Exclusion reasons must
be non-empty. A mapped entry has a coverage table with
these exact columns:

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |

Each row identifies exactly one Sub-features identifier; every identifier has
one row. Each coverage cell contains one or more literal `@case-<case-id>` tags
from its own suite, or exactly one non-empty reason in the form `n/a: <reason>`,
`desktop-only: <reason>` or `manual: <reason>`. Empty cells are invalid. Error
includes recovery; Entry points covers every reachable way in; Persistence
proves a reload round-trip or authoritative GraphQL read-back. Every case must
be cited by at least one cell. Only browser Playwright cases satisfy cells;
Vitest, native and manual evidence stays supplementary under Verifying it.

Wrap every suite's cases in one top-level
`featureSuite("<feature-id>", options?, body)` call, importing the helper from
`studio/e2e/features/featureSuite.ts`. It adds `@feature-<feature-id>` through
Playwright's `test.describe`. Options accept an extended Playwright test via
`test`, `isolation: "suite" | "case"` (default `"suite"`) and
`profile: "onboarded" | "first-run"` (default `"onboarded"`). First-run suites
run in the `first-run` project without a setup dependency; Chromium ignores
those suites and retains its onboarded setup dependency.

Case titles and tags are literal. Each case has exactly one globally unique
kebab-case `@case-` tag. Computed titles or tags, `skip`, `fixme` and `only`
calls are violations, including conditional skips inside cases.
Cases are discovered only from calls on a Playwright test binding: `test`, an
imported alias of `test`, or the extended test passed through `test`. Other
`.test(...)` methods inside a case, such as `RegExp.test`, are ordinary code.
The runner refuses to plan a selection that has a case without exactly one
`@case-` identity and names the offending suite and case.

### Commands

Run from the repository root:

- `bun run --cwd studio test:e2e:feature <feature-id>[,<feature-id>…]` runs the
  suites of the feature or features being changed.
- `bun run --cwd studio test:e2e:features` is the full-app run: every mapped,
  non-excluded feature in sweep order.
- `bun run --cwd studio test:e2e:features --list [--json]` lists derived feature
  identities, suite paths, isolation and cases.
- `bun run --cwd studio test:e2e:features --check` reports all map/suite drift
  and exits non-zero for violations.

The runner builds and serves one edition per run, resolved like every other
launcher: Pocock by default, core with `TICKETRY_EDITION=core`. It logs
`Edition: <edition> (default|explicit)` once, prebuilds the adapter and starts
each web stack in that edition, and gives the Playwright child the same
`TICKETRY_EDITION`. A Pocock run skips features whose `Editions:` omit `pocock`
and drops `@edition-core` cases; a core run skips only features whose
`Editions:` omit `core`. Skipped features and cases are printed when the run
starts and listed under **Skipped by edition** in the run summary, never
counted as passed or unrun. Explicitly naming a feature or case that the
edition does not contain fails and names the edition to rerun with. A
complete-map claim covers only the edition it ran; verify both editions with
two runs:

```bash
bun run --cwd studio test:e2e:feature <feature-id>                        # Pocock
TICKETRY_EDITION=core bun run --cwd studio test:e2e:feature <feature-id>  # core
bun run --cwd studio test:e2e:features                                    # Pocock sweep
TICKETRY_EDITION=core bun run --cwd studio test:e2e:features              # core sweep
```

`bun run --cwd studio test:e2e:planning` runs the seven core-only planning
suites in core. `--check` and `--list` do not depend on the edition.

A feature change updates its map entry and its suite together: new or changed
sub-features, coverage cells and `@case-` cases land in the same change, and
`--check` reports any mismatch between them.

During migration the drift check is a non-gating report and is not part of
`bun run --cwd studio test`; existing browser specs remain in place. The
zero-drift Vitest gate lands with CODING-2720 once every entry has a suite or a
reasoned exclusion and the legacy specs are retired.

## Non-feature browser specs

Browser specs outside `features/` must be listed here with a reason. The final
migration gate enforces this table; other existing specs are expected drift
until migration completes.

| Spec | Reason |
| --- | --- |
| `studio/e2e/graphql-mutation-surface.spec.ts` | Public mutation-surface contract. |
| `studio/e2e/arrow-hold-profile.spec.ts` | Performance profile. |

## Maintenance rule

Fix map drift in the same change that alters UI behavior, entry points, code
paths or coverage. Add an entry or a reasoned exclusion for each new area;
update the index. Run
`bun run --cwd studio test -- src/test/featureMapContract.test.ts` before
handoff, then the task's required checks. An automated updater is a separate
future item.

## Feature runner evidence

`bun run --cwd studio test:e2e:feature <feature-id>[,<feature-id>…]` runs selected
suites; `test:e2e:features` runs all mapped, non-excluded suites in sweep order.
Use `--case <case-id>` or `--grep <regex>` for partial evidence. Any explicit
filter prevents a complete-map claim, even when it matches every case.

Each suite (or each case for case isolation) owns a fresh disposable profile.
First-run suites use the `first-run` project; other suites require canonical
onboarding setup. Runs retain traces with retries disabled. Evidence, registry,
source hashes, the working-tree patch, invocation logs and cleanup records live
in `.ticketry-dev/e2e-results/<run-id>/`; `latest.md` links to the latest summary.
Migration drift still fails execution and is recorded alongside browser results.

Each case is classified from its own first-attempt execution and identity. A
failing case fails its feature, the run and the exit code, but a passing sibling
in the same invocation stays verified. Missing or errored reports, failed
onboarding, unexpected identities, dirty cleanup, source changes and a nonzero
Playwright exit that no failing case explains invalidate every case the
invocation owns.
The runner tests are `node --test studio/scripts/run-feature-e2e.test.mjs
studio/scripts/feature-e2e/*.test.mjs`. `feature-e2e/devServerWatch.test.mjs`
keeps each stack's dev server from watching `src-tauri/**`. Crawling the shared
Cargo target starved the proxy that carries browser GraphQL writes (T2914).
