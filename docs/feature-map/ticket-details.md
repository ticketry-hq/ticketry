# Ticket details

## Entry points

`studio/src/features/work-items/queries/index.ts` exposes `useWorkItem` and `getWorkItemSnapshot`; `queries/readTransport.ts` reads by public ID or display key using `WorkTrackerWorkItemDocument` / `WorkTrackerWorkItemByKeyDocument`. `mutationTransport.ts` owns creation, detail updates, transition, reparent, blockers, reorder and deletion transport. `mutations.ts` coordinates caller-scoped variables, optimistic cache updates and convergence.

Authored operations live in `studio/src/features/work-items/operations/workItems.graphql`; generation emits `studio/src/features/work-items/generated/workItems.documents.ts`; runtime reads/writes execute these typed documents. Parent, blockers, classification, archive and state changes use authored model-update selections and variables rather than a handwritten DTO contract.

## Types and conversion

`WorkItemRow` in `workItemView.ts` aliases the generated fragment. `WorkItem` adds only derived display key, child counts/presence and dependency ID arrays. `WorkItemCreateVariables` and mutation argument aliases derive from generated variables, retaining feature context separately where needed. These are caller/domain views with comments explaining their added or omitted fields.

The shared seam is `shared/api/worktrackerConversion.ts`: reads/mutation results call `publicResult` before `workItemView`; writes call `serverVariables`. Apollo remains the raw-record owner. Raw optimistic builders, attachment display aliases, cache keys and run-now legacy conversions are explicitly scoped in the [inventory](remaining-server-record-inventory.md).

## Coverage

`studio/src/features/work-items/workItemView.test.ts` covers derived values; `queries/readTransport.test.ts` covers reads. `mutationTransport.conversion.test.ts`, `mutationTransport.scoping.test.ts` and `mutations.test.tsx` cover document conversion, caller identity and writes. `internal/optimisticCreation.test.ts` and `internal/optimisticTransition.test.ts` cover optimistic behavior. Acceptance includes `studio/src/test/overhaulReparentConvergenceAcceptance.test.tsx`, `overhaulTransitionLandingAcceptance.test.tsx`, `overhaulDescriptionAutosaveAcceptance.test.tsx` and `overhaulWorkItemCreationPlacementAcceptance.test.tsx`. `studio/e2e/graphql-mutation-surface.spec.ts` exercises the real mutation surface.

Related surfaces: [stories list](stories-list.md), [projects](projects.md).
