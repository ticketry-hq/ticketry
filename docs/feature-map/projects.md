# Projects and modules

## Entry points

`studio/src/features/projects/queries/index.ts` owns `useProjectsQuery`, `useModulesQuery`, cached snapshots and load/seed adapters. `queries/readTransport.ts` owns `readProjects`, `readProjectOpen` and `readOnboardingProjects`. `mutationTransport.ts` executes generated project/module operations through the runtime GraphQL write transport. `modulePresentationTransport.ts` owns presentation writes and cache convergence; `mutations.ts` coordinates module reordering.

Authored operations live in `studio/src/features/projects/operations/projects.graphql`; code generation emits typed documents/selections in `studio/src/features/projects/generated/projects.documents.ts`. Apollo receives raw generated rows; frontend subscriptions use the same cache.

## Types and conversion

`Project` and `OnboardingProject` in `features/projects/types.ts` index generated query nodes. `ProjectCreate`, `ProjectPatch` and `ProjectCreateResult` derive from generated mutation variables/results; creation does not invent an unselected timestamp. `Module` extends the generated project-open module selection with the computed display `key` (project slug plus sequence). It is a domain view, not an independent server contract.

`publicResult(document, data)` in `shared/api/worktrackerConversion.ts` converts selected IDs and timestamps without replacing Apollo rows. `serverVariables(document, variables)` compacts only operation-declared identity variables. Module presentation/cache seeding identity exceptions are listed in the [inventory](remaining-server-record-inventory.md).

## Coverage

Focused contracts: `studio/src/features/projects/queries/readTransport.test.ts`, `queries/projectWriteRead.test.ts`, `mutationTransport.test.ts`, and `modulePresentationTransport.test.ts`. These cover result conversion, post-write reads, generated mutation execution and presentation behavior. Acceptance: `studio/src/test/overhaulProjectOnboardingAcceptance.test.tsx` and `overhaulModuleCreationAcceptance.test.tsx`. Runtime/database coverage: `studio/e2e/project-lifecycle.spec.ts`, `graphql-mutation-surface.spec.ts` and `model-settings-database.spec.ts`.

Related surfaces: [stories list](stories-list.md), [workflows](workflows-and-issue-types.md).
