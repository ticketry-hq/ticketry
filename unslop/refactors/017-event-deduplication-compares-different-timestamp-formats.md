# Event deduplication compares different timestamp formats

Status: implemented. Convergence keys normalize naive UTC and RFC3339 timestamps while retaining the full fractional component. Tests cover offset spelling, trailing zeroes, nanosecond precision, and distinct sub-millisecond edits. Acceptance case 268 verifies the matching event is skipped and a later external edit is fetched.

The review evidence below records the pre-fix behavior.

Priority: P2. Follow-up review of finding 005.

## Evidence

[workItemConvergence.ts](../../studio/src/features/work-items/workItemConvergence.ts), lines 6 to 7, keys raw timestamp strings. [mutationTransport.ts](../../studio/src/features/work-items/mutationTransport.ts) records mutation updated_at. [status_facts.rs](../../studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/status_facts.rs), lines 285 to 288, formats event timestamps with to_rfc3339_opts.

The installed, pinned Seaography 2.0.0-rc.9 implementation in src/outputs/entity_object.rs, lines 301 to 303, serializes ChronoDateTime with to_string. The entity timestamp is a timezone-free DateTime. Thus the same instant is represented as `2026-09-05 00:00:00` in the mutation and `2026-09-05T00:00:00+00:00` in the event.

## Why change it

The keys differ, so the event does not consume the locally converged version and repeats the entity and affected-list fetches. The new status-stream test supplies identical synthetic Z timestamps on both paths, hiding the production mismatch. Module scoping is improved, but the duplicate-fetch part of 005 remains unresolved.

## Smallest useful refactor

Use a shared version identity, or normalize both representations without losing sub-millisecond precision. Avoid identifying distinct rapid writes as the same event.

## Validation

Feed real mutation and status-event timestamp representations into the convergence test. Assert that the matching event causes no redundant fetch and a later external write still does. Include fractional seconds and UTC offset spelling differences.
