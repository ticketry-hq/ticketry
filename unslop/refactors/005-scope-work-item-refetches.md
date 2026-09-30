# Work-item convergence refreshes unrelated module lists

Priority: P2. Effort: Medium. Category: Performance.

## Evidence

- [studio/src/features/work-items/mutationTransport.ts](../../studio/src/features/work-items/mutationTransport.ts), line 66, `refetchQueries: options.moduleId`.
- [studio/src/features/agents/status/stream/workItemInvalidation.ts](../../studio/src/features/agents/status/stream/workItemInvalidation.ts), line 76, `include: [WorkTrackerModuleOpenDocument]`.
- [studio/src/features/agents/status/stream/statusFacts.ts](../../studio/src/features/agents/status/stream/statusFacts.ts), line 63, `readonly moduleId: string | null;`.

## Why change it

Create, reparent, blocker changes, and delete use document-wide module-list refetches. The status invalidator also refetches that document for any task membership change, although facts carry a module ID. With several active module queries, a change in one module refreshes the others. A local mutation and its later status fact can schedule separate refreshes once the first request has completed. The 50 ms batch only deduplicates facts within the invalidator.

## Smallest useful refactor

Collect affected module identities and refresh matching variables. Reparenting must cover both the old and new module. Keep a broad fallback when identities are genuinely unknown. Coordinate mutation and event convergence without dropping external updates or rank repairs.

## Validation

Observe requests with two active module queries. A create should refresh its module only; a cross-module move should refresh both affected modules. Deliver the matching event after mutation refresh completion to test duplicate work. Preserve authoritative convergence for external edits and cascading changes.
