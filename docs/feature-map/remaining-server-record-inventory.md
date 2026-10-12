# Remaining server-record inventory

Scope: handwritten server-shaped frontend types and direct ID/timestamp helpers after the projects, work-items and workflows migration. **Mirror** means manually repeated selected server fields; **view** means a justified projection, scalar narrowing, event payload or computed presentation. A view should still derive server field types wherever a generated selection exists. This inventory records follow-up work, not permission to add new mirrors or conversion importers.

## Types and owners

All paths below are relative to `studio/src/`.

| Owner / file | Types | Classification and follow-up |
| --- | --- | --- |
| Module links — `features/module-links/moduleLinkStore.ts` | `ModuleLink` | Generated fragment alias, no handwritten mirror. ID equality, raw cache seeds and writes still use compact helpers. Move operation conversion to the document seam separately. |
| Workspace tabs — `features/workspace-tabs/types.ts`, `queries.ts` | `WorkspaceTabIdentity`, `WorkspaceTabOrder`, `WorkspaceTabOrderQuery` | Genuine view: validated JSON identity union/order plus query state; removes retired `changes` identities for persistence. Operation/cache ID conversions remain. |
| Planning — `features/planning-graph/planningModel.ts` | `PlanningState`, `PlanningSprint`, `PlanningModule`, `PlanningWorkItem`, `PlanningGraph` | Generated selection projections. Module/work-item views add a display key and flattened type name; sprint narrows validated status; graph assembles creation availability and lookup maps. These are not replacement model contracts. `convergence.ts` still normalizes query/project keys. |
| Agent status — `features/agents/status/types.ts` | `RunRecord` | Remaining handwritten projection/mirror of status snapshot fields with narrowed lifecycle/scope and computed effective state. Derive server fields from `RunHoldingPayload` in follow-up. |
| Agent status — `features/agents/status/types.ts` | `AutomationAttemptRecord` (including nested failure) | Remaining mirror with status/delivery narrowing; derive fields from `AutomationAttemptPayload` in follow-up. |
| Agent status — `features/agents/status/types.ts` | `RunStatusEventFrame`, `AgentStatusData`, generated frame aliases | Genuine views: JSON payload narrowing and indexed holding/stall-clock metadata; other frames alias generated subscription selections. |
| Agent status — `features/agents/status/apolloHolding.ts` | `CachedRun`, `CachedAttempt`, `CachedHolding`, `HoldingQueryData` | Remaining private handwritten cache-selection contracts. Cached run/attempt repeat selected server fields and client-only status fields; holding/query envelopes are Apollo client schema views. Generate/derive selection fields in follow-up. |
| Status events — `features/agents/status/stream/statusFacts.ts` | `WorkflowStateRow`, `AgentRunFact`, `AgentRunActivityFact`, `WorkItemFact`, `WorkflowStateFact`, `AutomationAttemptFact`, `DocumentFact`, `WorktreeFact` | Genuine validated durable-event views, not full model rows. `WorkflowStateRow` derives selected fields from generated `State`. Workflow state facts intentionally carry only displayed fields, omit protected fields/timestamps, and merge into complete generated catalog rows. Unknown state facts trigger canonical catalog reads. |
| Revision overlay — `shared/stateCatalogRevision.ts` | `CatalogState` | Generated-schema-derived partial revision view; nullable identity/color and optional sort/protection support incomplete facts. Existing revision/authoritative-state maps retain an overlay outside Apollo and remain a separate state-ownership follow-up; this task did not migrate that mechanism. It is not a complete State contract. |
| Worktrees — `features/agents/worktrees/internal/types.ts` | `WorktreeStatus`, `DiscardResult` | Remaining handwritten transport projection/mirror: generated status fields are copied, while kind is narrowed and optional absence retained. Derive fields from generated status/discard selections in follow-up; `statusTransport.ts` currently adapts field by field. |
| Worktrees — `features/agents/worktrees/internal/changesTransport.ts` | `CreatedPullRequest` | Remaining one-field mutation-result projection (`url`); derive from generated pull-request mutation result in follow-up. |
| Worktree checkout list — `features/agents/worktrees/changes/worktreeCheckoutRows.ts` | `WorktreeCheckoutStatus`, `WorktreeCheckoutRow` | Status is a remaining handwritten selected-status mirror; derive from generated current-worktree status. Row is a genuine display projection with label, summary and tone. |
| Worktree changed files — `features/agents/worktrees/changes/changedFileTree.ts` | `ChangedFileRow`, `ChangedFileTreeRow` | File is a remaining handwritten changed-file projection; derive selected fields from generated changes. Tree row is a genuine directory/depth/statistics view. |
| Worktree pull requests — `features/agents/worktrees/changes/PullRequestStatus.tsx` | `PullRequestStatusValue` | Remaining handwritten selected pull-request status mirror; derive from generated version-control/status selection. |
| Worktree lifecycle — `features/agents/worktrees/changes/WorktreeLifecycle.tsx` | `WorkItemClosureFailureValue`, `WorktreeCleanupValue` | Remaining handwritten nested response projections; derive failure/cleanup selection fields in follow-up. These are response diagnostics, not WorkItem rows. |
| Worktree merge prompting — `features/agents/worktrees/changes/mergeConflictPrompt.ts` | `MergeConflictFacts` | Genuine prompt context combining merge target, conflict paths and identifiers; not a complete Git/server row. |
| Terminal creation — `features/agents/terminal/internal/mutationTransport.ts` | `CreatedInstantConversation` | Remaining selected result projection with provider narrowing; derive generated run identity/provider fields in follow-up. Create/resume/launch input types are caller-specific requests, not stored server records. |
| Terminal presentation — `features/agents/terminal/internal/sessionStore.ts`, `hooks.ts` | `SessionMeta`, `SessionTab` | Genuine attach/viewer/tab metadata: local session identity, transport, planning/instant/shell flags and deferred attachment state; not a durable terminal-session mirror. |
| Agents — `features/agents/types.ts` | `PersistedTerminalSession`, `ResumableTerminalSession` | Remaining handwritten terminal-session/listing projections with launch/provider/resume snapshot fields; derive from generated terminal selections in follow-up. Lifecycle enums, identity aliases and tab kinds are domain/client types. |
| Terminal panel — `features/terminal-panel/api/moduleShellApi.ts` | `ModuleShell` | Remaining handwritten `agent_run_id`, `module_id`, `created_at` projection; derive from generated `ModuleShellSessions` node in follow-up. |
| Documents — `features/documents/types.ts` | `DesignDoc` | Genuine view: registry identity/root-relative path/digest plus derived label; runtime directory root/discovery run intentionally remain hidden. Derive shared registry field types in follow-up. |
| Settings — `features/settings/providerTypes.ts` | `ProviderCapabilities`, `ConfigurableProvider`, `GlobalLaunchDefault`, `ProviderCatalog`, `SubtreeRunCapabilityMap` | Genuine domain projections: provider activation/default choices and model/reasoning compatibility assembled from catalog joins, with configured provider slug narrowing. Subtree eligibility is a computed issue-type-to-state map. These do not describe unrestricted database rows. |
| Settings — `features/settings/instantLaunchSettings.ts`, `changeLedger.ts`, `store.ts` | `InstantLaunchSettings`, ledger collections, settings state | Genuine views: decoded/validated JSON preferences, edit feedback and generated-feature record references. `settings/queries.ts` retains per-field ID conversion and test-seeded derived capability maps. |
| Onboarding — `app/onboarding/onboardingStore.ts` | `CachedProject` | Generated onboarding node alias used for raw Apollo cache rows; the store resolves installation-project/onboarding rules, with direct compact-ID normalization for cache writes/equality. |
| Project presentation — `features/projects/modulePresentationTypes.ts` | `ModulePresentation` | Generated selection excluding `__typename`, no handwritten mirror; presentation owns rank/visibility for module tabs. |
| Attachments — `features/work-items/attachmentView.ts` | `Attachment` | Genuine generated attachment view: aliases `issue_id` to `issue`, file to display URL; other server fields derive from the generated attachment query. |
| Navigation — `shared/navigation/view.ts`, `app/navigation/view.ts` | `NavigationView`, `View` | Client-only choice union, shared by navigation/selection. Not a server shape. |
| Module load diagnostics — `shared/utilities/moduleLoadProbe.ts` | `Trace`, `Details` | Genuine bounded development timing metadata; stores identity and counters, never task records. Compact-ID matching is diagnostic attribution only. |

Feature-local selector rows, editor drafts, GraphQL response envelopes, mutation caller context, execution diagnostics, prototype mock conversations, layout/drag state and client persistence furniture are genuine non-server views. They must not become copied model-row contracts. The adopted record views and their reasons are documented in [projects](projects.md), [ticket details](ticket-details.md), [stories list](stories-list.md) and [workflows](workflows-and-issue-types.md).

## Exact helper-import allowlist

The table below is the complete importer/helper contract of `studio/scripts/worktracker-helper-imports.mjs`. Importer paths are relative to `studio/src/`. Architecture lint checks exact pairs, including aliased imports; it is a frozen migration baseline, so remove a pair when that importer adopts the seam. It does not authorize additional helpers or transport importers.

| Importer | Allowed helper | Reason / remaining work |
| --- | --- | --- |
| `app/onboarding/onboardingStore.ts` | `compactWorktrackerId` | Raw Apollo onboarding cache writes and identity equality. |
| `features/agents/status/stream/workItemInvalidation.ts` | `compactWorktrackerId` | Cache invalidation and query identity matching. |
| `features/agents/status/stream/workflowStateConvergence.ts` | `publicWorktrackerId` | Durable state fact IDs converge to public catalog identities. |
| `features/agents/worktrees/changes/WorktreeSwitcher.tsx` | `compactWorktrackerId` | Compare selected task and checkout identities. |
| `features/agents/worktrees/changes/useWorktreeCheckouts.ts` | `compactWorktrackerId` | Match module/task checkout and status identities. |
| `features/module-links/moduleLinkStore.ts` | `compactWorktrackerId` | Raw cache seeds and module identity equality. |
| `features/module-links/moduleLinkTransport.ts` | `compactWorktrackerId` | Legacy operation/cache identity conversion; adopt seam in follow-up. |
| `features/planning-graph/convergence.ts` | `compactWorktrackerId` | Refetch/cache convergence across public/compact project identities. |
| `features/planning-graph/convergence.ts` | `publicWorktrackerId` | Refetch/cache convergence across public/compact project identities. |
| `features/projects/modulePresentationTransport.ts` | `compactWorktrackerId` | Match raw presentation cache rows after document-scoped writes. |
| `features/projects/mutations.ts` | `compactWorktrackerId` | Raw optimistic module presentation reorder rows. |
| `features/projects/queries/index.ts` | `compactWorktrackerId` | Raw cache seeds and cache-row identity construction. |
| `features/projects/stateCatalog.ts` | `compactWorktrackerId` | Raw state cache identity and removal keys. |
| `features/settings/queries.ts` | `compactWorktrackerId` | Legacy query variables and derived launch-state IDs; adopt seam in follow-up. |
| `features/settings/queries.ts` | `publicWorktrackerId` | Legacy query variables and derived launch-state IDs; adopt seam in follow-up. |
| `features/work-items/internal/optimisticCreation.ts` | `compactWorktrackerId` | Permanent raw optimistic server-row builder. |
| `features/work-items/internal/optimisticTransition.ts` | `compactWorktrackerId` | Permanent raw optimistic server-row builder. |
| `features/work-items/internal/optimisticUpdates.ts` | `compactWorktrackerId` | Permanent raw optimistic server-row builder. |
| `features/work-items/planMutation.ts` | `compactWorktrackerId` | Permanent optimistic-layer key identity normalization. |
| `features/work-items/planWriteGuard.ts` | `compactWorktrackerId` | Permanent pending-write key identity normalization. |
| `features/work-items/queries/useWorkItemAttachments.ts` | `compactWorktrackerId` | Legacy variables and attachment display IDs; adopt seam in follow-up. |
| `features/work-items/queries/useWorkItemAttachments.ts` | `publicWorktrackerId` | Legacy variables and attachment display IDs; adopt seam in follow-up. |
| `features/work-items/runNow.ts` | `compactWorktrackerId` | Legacy catalog/read IDs and raw optimistic transition rows; move operation conversion to seam in follow-up. |
| `features/work-items/runNow.ts` | `publicWorktrackerId` | Legacy catalog/read IDs and raw optimistic transition rows; move operation conversion to seam in follow-up. |
| `features/work-items/utilities/arrivalRank.ts` | `compactWorktrackerId` | Identity matching for computed destination rank. |
| `features/work-items/workItemConvergence.ts` | `compactWorktrackerId` | Identity component of a convergence key. |
| `features/workflows/queries/issueTypeMetadata.ts` | `compactWorktrackerId` | Permanent raw optimistic metadata builder. |
| `features/workspace-tabs/mutations.ts` | `compactWorktrackerId` | Legacy operation/cache ID conversion; adopt seam in follow-up. |
| `features/workspace-tabs/queries.ts` | `compactWorktrackerId` | Legacy query variables and cache key; adopt seam in follow-up. |

### Timestamp parsing outside the document seam

No production feature imports `publicWorktrackerTimestamp` directly. Remaining timestamp interpretation is domain comparison, not rewritten GraphQL wire rows: `features/execution/usePersistedSubtreeRun.ts` locally adds a missing UTC suffix before `Date.parse` when matching campaign/run start times; `features/agents/status/apolloHolding.ts` compares update times and expiry cutoffs; `features/agents/status/automationDelivery.ts` orders delivery timestamps; `features/agents/status/runPresentation.ts` checks output staleness. `features/agents/status/launchDiscoveryTrace.ts` creates diagnostic ISO observation timestamps. The existing work-item convergence precision key and optimistic-creation timestamps stay within the adopted feature's identity/optimistic exception scope. The execution UTC fallback is a remaining normalization seam to consolidate if generated timestamp contracts change.

### Shared plumbing outside the importer guard

`shared/apollo/cacheKeys.ts` uses `compactWorktrackerId` for Apollo `keyFields`; `shared/utilities/moduleLoadProbe.ts` uses it for trace identity equality. They are intentional identity-key/diagnostic exceptions outside the `app/` and `features/` guard. `shared/api/worktrackerConversion.ts` owns `compactWorktrackerId`, `publicWorktrackerId` and `publicWorktrackerTimestamp` at the shared document seam. `shared/api/generatedWorktracker.ts` defines these primitives. No direct `publicWorktrackerTimestamp` caller remains outside that seam in production frontend files.

Apollo raw optimistic rows/cache seeds are exceptions because compact IDs belong in raw normalized cache records. Query/mutation variables and user-facing result conversion belong at the document seam; a cache-key exception never authorizes new per-field operation conversion.

## Checks and coverage

All listed allowlist pairs correspond to live imports at inventory creation. The migration/architecture guard is `studio/scripts/frontend-architecture-lint.mjs` together with `studio/eslint.config.js`; it rejects state-layer generated contracts/adopted feature record imports. `studio/src/shared/api/worktrackerConversion.test.ts` covers selection aliases/fragments, nullable values, nested IDs/timestamps and operation variable conversion. Feature-specific transport/view/acceptance tests are linked from each page. Remaining mirrors need generated-contract derivation plus focused owner tests when their follow-up migration is implemented.

This page records source inspection. Full-gate status must come from the implementation run's actual validation evidence.
