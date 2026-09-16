# Follow-up review

Implementation update: all five findings below are addressed. See [implementation and validation](IMPLEMENTATION.md). The findings are retained as the review history.

Reviewed the uncommitted refactor changes against the original 14 findings. HEAD was 445adcf8. The working tree also contains earlier unrelated changes, which are outside this follow-up. No application changes were retained.

## Standards

- P2: [015, workspace updates notify both unrelated shell stores](015-workspace-updates-notify-shell-stores.md). Confirmed with a temporary runtime probe.
- P2: [009, workspace state still combines several concerns](009-split-client-store-by-owner.md). The location and shell extraction improved, but the large store remains.
- P3: [014, architecture lint permits side-effect imports and new imports in exempt files](014-extend-frontend-architecture-lint.md). Both bypasses reproduced directly.

## Spec

- P2: [017, mutation/event deduplication uses mismatched timestamp formats](017-event-deduplication-compares-different-timestamp-formats.md). Finding 005 is only partially resolved.
- P2: [016, worktree revalidation returns stale dirty state and cleanup eligibility](016-worktree-revalidation-keeps-stale-dirty-state.md). Finding 007 is only partially resolved.

## Original findings

| Findings | Result |
| --- | --- |
| 001, 002 | Memoized document adaptation, content-based loading, cancellation, and draft guards added. Relevant acceptance tests pass. |
| 003, 004, 006 | Eager fetch removed, foreground claims moved to Apollo with focused subscriptions, and Git status shared within a read. |
| 005 | Module scoping added; timestamp deduplication remains ineffective. |
| 007 | Lock released for remote requests; local revalidation remains incomplete. |
| 008 | Requested components extracted. The remaining section is still 484 lines. |
| 009 | Partial; see standards findings above. |
| 010, 011 | Document UI moved into its feature; terminal viewer worker/protocol code split into private modules. |
| 012 | Requested adoption concerns extracted into private modules. Some extracted files remain large. |
| 013 | Renderer guidance corrected. |
| 014 | Checks added, with the bypasses above. |

## Validation

Passed: TypeScript typecheck, architecture lint and its 3 tests, all 392 overhaul tests across 123 files, 29 focused frontend tests, 11 Rust worktree changes tests, crate-tier layout, and the public API boundary contract. A temporary probe also confirmed the shell-store notification regression and was removed. The test runs emit existing jsdom/canvas and environment warnings; no listed suite failed.

No live performance profiling or packaged-desktop run was performed. Passing tests do not cover the missing GitHub interleaving or production timestamp mismatch described above.

Three standards findings and two spec findings. The main standards regression is extra shell-store notifications; the main spec correctness issue is stale worktree cleanup eligibility.
