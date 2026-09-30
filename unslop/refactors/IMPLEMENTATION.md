# Follow-up fixes

Implemented all five findings from REVIEW.md.

- Worktree changes read current Git status and file changes after the provider wait, under the reacquired repository lock. The status result is shared by the dirty-state and changed-file calculations.
- Local event convergence normalizes timestamp representations without rounding fractional seconds.
- Workspace updates no longer forward unchanged dialog and toast values. Explicit compatibility writes still work.
- The workspace store is composed from focused action modules, with no additional state owner.
- Architecture lint parses TypeScript imports and limits exceptions to exact importer/target pairs.

## Regression coverage

[The Rust concurrency test](../../studio/src-tauri/tests/worktree_changes_concurrency.rs) pauses a fake GitHub process, verifies a local status request can proceed, stages a file without changing HEAD, then verifies the response includes the file and blocks cleanup. It uses temporary repositories and databases.

[Workspace acceptance case 267](../../studio/src/test/overhaulWorkspaceStoreIsolationAcceptance.test.tsx) verifies shell notifications and visible dialog/toast retention. [Status acceptance case 268](../../studio/src/test/overhaulStatusStreamConsumerAcceptance.test.tsx) checks matching production timestamp formats and a later external edit. Existing cleanup case 200 also checks that a dirty checkout displays its changed file while withholding cleanup.

[Timestamp tests](../../studio/src/features/work-items/workItemConvergence.test.ts) exercise offsets, nanoseconds, and distinct identities. [Architecture tests](../../studio/scripts/frontend-architecture-lint.test.mjs) cover the reported bypasses and avoid false positives in comments and strings.

The workflow acceptance fixture had an existing TypeScript excess-property error; its data is preserved using an intermediate value. Its combined case 246 already exercises the scenarios listed as cases 262 and 263, so those gate identifiers now point to that test instead of remaining orphaned in the matrix.

## Validation

Passed:

- TypeScript typecheck and architecture lint.
- All 6 architecture lint tests.
- All 70 focused frontend tests.
- All 392 overhaul tests across 123 files.
- All 21 Rust tests across worktree changes, worktree commands, provider-wait concurrency, crate tiers, and the public API boundary contract.
- `git diff --check`.

The first overhaul run found the orphaned workflow case identifiers described above; the complete rerun passed after linking them to their existing combined test. No live performance benchmark or packaged desktop run was performed.
