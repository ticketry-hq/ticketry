# Workflows and issue types

## Entry points

`studio/src/features/workflows/queries/projectCatalog.ts` reads and snapshots the generated project workflow catalog; `queries/readTransport.ts` exposes state, issue-type, scoped-settings and subtree-capability reads. `queries/index.ts` loads editor resources/settings and derives usage/impact diagnostics. `queries/scopedWorkflowSettings.ts` assembles editor settings. `mutationTransport.ts` executes generated state, issue-type, transition and launch-binding operations; `features/settings/queries.ts` supplies settings subscriptions to the same catalog.

Authored read fragments live in `studio/src/features/projects/operations/projects.graphql`; authored workflow writes live in `studio/src/features/workflows/operations/workflows.graphql`. Read fragments are generated with the project documents in `features/projects/generated/projects.documents.ts`; write operations/variables are generated in `features/workflows/generated/workflows.documents.ts`.

## Types and conversion

`features/workflows/types.ts` aliases generated `State`, `WorkflowTransition` and `LaunchBinding` fields. `IssueType` narrows the generated string level to the validated `module | task` domain; metadata uses a `Pick` of this record. Create/update field types derive from authored generated variables.

`ScopedWorkflowSettings` and its transition/launch-binding families are assembled editor views: they resolve model identities into provider/model names and add computed warnings. `WorkflowGraph`, `IssueTypeWorkflow`, impact/diagnostic records and editable drafts describe topology, previews or editing state rather than stored rows. Their differences must be documented at their declarations. Provider capabilities/catalog/default choices and subtree maps are settings/workflow domain projections, not model CRUD contracts.

`publicResult` / `serverVariables` in `shared/api/worktrackerConversion.ts` convert generated reads and writes once at the document boundary. `queries/issueTypeMetadata.ts` may build raw optimistic metadata for Apollo; settings subscription legacy helper pairs are in the [inventory](remaining-server-record-inventory.md).

## Coverage

`studio/src/features/workflows/queries/readTransport.test.ts`, `mutationTransport.test.ts`, `providerQueries.test.ts` and `launchBindingValidation.test.ts` cover catalog assembly, typed operations and launch choices. Acceptance includes `studio/src/test/overhaulWorkflowSettingsAcceptance.test.tsx`, `overhaulWorkflowStateColorsAcceptance.test.tsx`, `overhaulWorkflowCodexProfileAcceptance.test.tsx`, `overhaulWorkflowStageSkillsAcceptance.test.tsx` and `overhaulWorkflowStageSkillSerializationAcceptance.test.tsx`. `studio/e2e/model-settings-database.spec.ts` and `graphql-mutation-surface.spec.ts` cover persistence and the real mutation surface.

Related surface: [ticket details](ticket-details.md).
