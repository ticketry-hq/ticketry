# Stories list

## Entry points

`studio/src/features/work-items/queries/StoriesTreeProvider.tsx` and `queries/useStoriesTree.ts` compose the selected module's list. `queries/index.ts` exposes `useModuleOpen`, `useModuleItems`, `useModuleTree` and `loadModuleTree`. `queries/readTransport.ts` reads `WorkTrackerModuleOpenDocument` / `WorkTrackerWorkItemsDocument`, derives ordered work-item views and builds `ModuleTree`. Selectors under `features/work-items/selectors/` assemble list rows and grouping from those views.

## Types and conversion

Authored module/project work-item selections live in `studio/src/features/work-items/operations/workItems.graphql`; typed documents/selections are generated in `features/work-items/generated/workItems.documents.ts`. `workItemView.ts` derives `WorkItem` from a generated fragment, adding display/dependency/child values. `ModuleTree` owns UI topology (`rootIds`, children and canonical order); selector tree rows, scratch rows and instant-run rows are presentation views. They are not server records.

`publicResult` / `serverVariables` in `shared/api/worktrackerConversion.ts` form the shared read/write conversion boundary. The cache stores raw generated rows. List ordering uses rank byte ordering with sequence/identity fallbacks; presentation code does not own a second server-state snapshot. The separate planning graph has its own narrower views and remaining exceptions in the [inventory](remaining-server-record-inventory.md).

## Coverage

`studio/src/features/work-items/queries/readTransport.test.ts`, `workItemView.test.ts`, `workItemConvergence.test.ts` and `internal/optimisticCreation.test.ts` cover transport, derived records and cache convergence. Acceptance includes `studio/src/test/overhaulModuleTreeSubscriptionAcceptance.test.tsx`, `overhaulStoryReorderAcceptance.test.tsx`, `overhaulWorkItemCreationPlacementAcceptance.test.tsx` and `overhaulReparentConvergenceAcceptance.test.tsx`. `studio/e2e/project-lifecycle.spec.ts` exercises project/module runtime lifecycle; `graphql-mutation-surface.spec.ts` covers real writes.

Related surfaces: [ticket details](ticket-details.md), [projects](projects.md).
