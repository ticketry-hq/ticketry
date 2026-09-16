# Slop audit

24 findings, recorded individually as they were confirmed on 2026-09-05. No application code was changed.

Scope: the codebases in this repository, including Studio frontend, Rust workspace and desktop shell, development/release scripts, review-workbench, and catalog tooling. No repositories outside this directory were audited.

The inventory covered 1,695 source and test files. Searches across that inventory identified candidates for focused reading and whole-repository caller checks. This was a static audit, not a line-by-line certification that all remaining code is necessary. Generated contracts, dependencies, and build artifacts were excluded from cleanup candidates.

Existing uncommitted changes were included in the review and left untouched. Findings describe the working tree at review time; repeat reference checks before applying them.

## Findings by likely payoff

Dead paths and larger removals come first. Small unused APIs follow. Tests that check source spelling need behavioral replacements where their intended requirement still matters.

- [016: Tool discovery still builds an environment for an uncalled backend path](016-unused-backend-environment-exporter.md)
- [011: Scratch-agent counter has no callers](011-scratch-agent-counter-has-no-callers.md)
- [010: State catalog increments a global generation nobody reads](010-state-catalog-global-generation-is-never-read.md)
- [009: Imperative worktree status reader has no production caller](009-worktree-status-reader-exists-only-for-tests.md)
- [003: Worktree callers build a context that every transport discards](003-worktree-context-is-built-only-to-be-discarded.md)
- [001: Entry-skill acceptance test checks spelling instead of delivery](001-entry-skill-test-checks-source-text.md)
- [002: Single-host test only checks for one matching string](002-single-modal-host-test-does-not-count-hosts.md)
- [004: Renderer decision test freezes prose and benchmark numbers](004-renderer-decision-test-freezes-prose.md)
- [013: Unused workflow-transition reader duplicates an active read path](013-workflow-transition-reader-is-dead-duplicate-mapping.md)
- [019: Terminal authority clear method has no caller](019-unused-terminal-authority-clear-method.md)
- [020: Status-event count query is unused despite its test-coverage comment](020-unused-status-event-count-query.md)
- [006: canonicalModules discards its identity and returns another adapter's result](006-canonical-modules-wrapper-adds-nothing.md)
- [015: Settings seed wrappers have no callers](015-settings-seed-wrappers-have-no-callers.md)
- [017: Review workbench reconstructs identities from display labels](017-review-workbench-parses-its-own-display-labels.md)
- [008: Timestamp helper manually converts a clock value Chrono already provides](008-timestamp-helper-manually-roundtrips-the-system-clock.md)
- [005: Unused terminal launch alias and close wrapper](005-unused-terminal-launch-alias-and-close-wrapper.md)
- [007: cloneCollections only wraps structuredClone](007-clone-collections-only-wraps-structured-clone.md)
- [018: Data-directory acquisition convenience method has no caller](018-unused-data-directory-acquisition-wrapper.md)
- [021: Operation resource-kind wrapper has no caller](021-unused-operation-resource-kind-wrapper.md)
- [024: Desktop notice publishing method has no caller](024-unused-desktop-notice-publishing-method.md)
- [012: Entry-pool test helper is unused even by tests](012-entry-pool-test-helper-is-unused-even-by-tests.md)
- [014: readModules is an unused forwarding function](014-read-modules-is-an-unused-forwarding-function.md)
- [022: Launch discovery exports an unread renderer-instance accessor](022-unused-launch-discovery-instance-accessor.md)
- [023: Renderer measurement reset has no caller](023-unused-renderer-measurement-reset.md)

## Validation and limits

Checked caller references, inspected implementations and relevant tests, and verified the finding files and index. Application tests were not run because this task changed documentation only. Each finding names checks to run when implementing its cleanup.

Required crate boundaries, generated GraphQL contracts, architecture guards, and the documented native-terminal migration code were not classified as slop merely for existing. No dependency removal was established. A net line reduction is not claimed because several test deletions require replacement coverage.
