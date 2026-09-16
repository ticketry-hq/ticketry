# Refactor review

14 findings from the working tree on 2026-09-05. Application code and existing audit files were left untouched.

Start with 013 for documentation, 008 for a mechanical component split, and 006 for a redundant Git call. Prioritize 001 and 002 for document correctness. Finding 007 has a larger performance payoff but needs concurrency tests.

P1 means correctness or a potentially long interaction stall; P2 means useful structural or performance work; P3 means prevention. Effort is an estimate, not a commitment.

## Findings

| File | Priority | Effort | Category |
| --- | --- | --- | --- |
| [001: Document rows lose identity and trigger redundant content loads](001-document-identity-reloads-content.md) | P1 | Small | Performance and correctness |
| [002: Document loads can apply an obsolete response](002-cancel-stale-document-loads.md) | P1 | Small | Correctness and hygiene |
| [003: Selecting a task fetches changes before the changes tab needs them](003-avoid-eager-worktree-changes-fetch.md) | P2 | Small | Performance |
| [004: Terminal foreground selectors subscribe to the entire registry](004-terminal-foreground-store-subscriptions.md) | P2 | Small to medium | Performance and guideline violation |
| [005: Work-item convergence refreshes unrelated module lists](005-scope-work-item-refetches.md) | P2 | Medium | Performance |
| [006: One changes read runs the same Git status command twice](006-reuse-git-status-result.md) | P2 | Small | Performance |
| [007: GitHub reads hold the lock for every worktree in a repository](007-release-repository-lock-before-github.md) | P1 | Medium | Performance |
| [008: IssueTypesSection contains several independently editable controls](008-split-workflow-configuration-ui.md) | P2 | Small | Guideline violation and maintainability |
| [009: The minimal client-state folder owns most workspace behavior](009-split-client-store-by-owner.md) | P2 | Medium | Guideline violation and maintainability |
| [010: Document editing lives inside the application shell](010-move-document-ui-into-feature.md) | P2 | Medium | Guideline violation and maintainability |
| [011: Terminal webview commands also implement the viewer worker](011-split-terminal-viewer-command-module.md) | P2 | Medium | Guideline violation and maintainability |
| [012: Terminal adoption combines schema inspection and snapshot management](012-split-terminal-adoption-module.md) | P2 | Medium | Guideline violation and maintainability |
| [013: CLAUDE.md contradicts the shipping renderer instructions](013-correct-renderer-guidance.md) | P2 | Small | Guideline violation and hygiene |
| [014: Frontend lint checks only two import spellings in the state folder](014-extend-frontend-architecture-lint.md) | P3 | Small | Hygiene and prevention |

## Guidelines checked

- Small, focused files and frontend domain placement have concrete violations in 008 through 012.
- Apollo state ownership and subscription behavior need attention in 004. DOM and process handles require runtime registries; they are not automatically duplicate application state.
- Renderer guidance consistency fails in 013.
- The existing Rust crate-tier test passed. A scan found no public module declarations in crate roots. The full public API fixture test was inspected but not executed.
- The existing frontend state lint passed, with the limits described in 014.
- A tracked-file scan found no `.db`, `.sqlite*`, `.dylib`, `.wasm`, or `ticketry.log` files. This is not a complete artifact or secret scan.

## Scope and evidence

This was a static structure review of the current Studio frontend, Rust workspace, and repository guidance, using source inventories and focused call-path inspection. Generated contracts and dependencies were excluded from file-size candidates. Existing uncommitted changes were included, so verify locations again before implementation. Prior findings directly under `unslop/` were read and are not repeated here.

Performance findings identify concrete repeated work, subscription behavior, and lock lifetimes. No live profiling was performed and no latency or render-count improvement is claimed. The review does not certify every GraphQL operation, migration invariant, native boundary, or acceptance case. Those require their own contract and runtime checks.

Validation completed: the crate-tier test compiled and ran standalone with rustc, client-store ESLint passed, and `git diff --check` passed. No product code changed, so the full application and overhaul suites were not run. Each finding specifies the checks needed when implementing it.

## Follow-up

Implemented tasks from the next review, with [validation results](REVIEW-IMPLEMENTATION.md):

- [018: Prevent false terminal loss during launch](018-reconciliation-snapshot-order.md)
- [019: Retain failed description drafts](019-retain-failed-description-drafts.md)
- [020: Refresh the destination after reparenting](020-reparent-destination-convergence.md)
- [021: Move work-item search UI into its feature](021-work-item-picker-placement.md)
- [022: Serialize description autosaves](022-serialize-description-autosaves.md)

See [the implementation review](REVIEW.md) for the original implementation review. All five follow-up findings have now been fixed; see [implementation and validation](IMPLEMENTATION.md).
