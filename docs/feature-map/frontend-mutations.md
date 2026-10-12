# Frontend mutations feature map

Studio sends GraphQL writes as **declared mutations**. A feature declares a
mutation's generated document and its cache effects as data. One shared executor
runs that declaration through the one Studio Apollo client. The module lives in
[`shared/apollo/declaredMutation/`](../../studio/src/shared/apollo/declaredMutation/index.ts).
It has no domain knowledge: it knows nothing about work items, projects or
workflows. CODING-2728 owns the capability; its
[spec](../plans/CODING-2728-mutation-cache-effects-spec.md) records the design
decisions.

## What the executor does

[`executeDeclaredMutation`](../../studio/src/shared/apollo/declaredMutation/executeDeclaredMutation.ts)
runs three phases in order. Their semantics are part of the contract and are
tested:

1. **Write.** Send the mutation with the declaration's optimistic response, if
   it has one. If the write fails, Apollo discards the optimistic layer, the
   failure is mapped and tagged as a `write` failure, and nothing else runs.
2. **Commit effects.** Apollo normalizes the authoritative entity. The
   membership update and evictions run with it in Apollo's `update` callback.
   Garbage is collected once if anything was evicted. Then the post-commit hook
   (`committed`) runs. Each effect runs exactly once per committed write.
3. **Refresh.** Re-read every declared query.
   [`postWriteRefresh.ts`](../../studio/src/shared/apollo/declaredMutation/postWriteRefresh.ts)
   removes duplicate reads by query document and exact variables, so two entries
   for the same module produce one request. Each read is `network-only` and
   runs with `queryDeduplication: false`. A post-write read therefore never
   joins a request that started before the write and would deliver pre-write
   data. Each read is also marked as superseding earlier reads of the same
   operation and variables:
   [`supersededReadLink.ts`](../../studio/src/shared/apollo/supersededReadLink.ts)
   answers a pre-write read that lands after it from the refreshed cache, so a
   late response cannot write pre-write list membership back. A declared read
   runs whether or not a component is watching it, so a module list that is not
   on screen still converges. Every read is allowed to
   settle, and the first failure rejects.

If a refresh fails, the committed entity stays in the cache and the mutation is
never re-sent. The caller's promise still rejects, and the error is tagged with
the `refresh` phase. Callers can then tell "your change saved but the view could
not refresh" apart from "your change failed".

The executor adds no revision comparison of its own. The issue revision guard
link keeps sole authority over rejecting older `WorktrackerIssue` rows. Apollo's
`InMemoryCache` stays the only state owner: declarations write cache rows and
never keep a snapshot of their own.

### Error contract and phase tags

[`mutationFailure.ts`](../../studio/src/shared/apollo/declaredMutation/mutationFailure.ts)
maps every rejection once, through
[`graphQlMutationError`](../../studio/src/shared/api/graphqlError.ts). A
`FoundationGraphQlError` becomes the established REST-shaped `ApiError`: its
domain code maps to status 404, 400, 409, 403, 401, 503 or 422, and the body
carries `code` and `detail`. Any other error passes through unchanged.

`mutationFailurePhase(error)` returns `"write"` or `"refresh"` for a
declared-mutation rejection, and `null` for any other error. The declaration's
`diagnostics.failed(phase, error, args)` hook receives the same mapped error and
phase.

## Entry points

All of these are exported from
[`declaredMutation/index.ts`](../../studio/src/shared/apollo/declaredMutation/index.ts).

| Entry point | File | Purpose |
| --- | --- | --- |
| `declareMutation(declaration)` | [`declaration.ts`](../../studio/src/shared/apollo/declaredMutation/declaration.ts) | Infers a declaration's types from its generated document. A wrong root field or variable fails type-checking. |
| `refreshRead(query, variables)` | [`declaration.ts`](../../studio/src/shared/apollo/declaredMutation/declaration.ts) | A typed refresh entry whose variables must match the query document. |
| `executeDeclaredMutation(declaration, args)` | [`executeDeclaredMutation.ts`](../../studio/src/shared/apollo/declaredMutation/executeDeclaredMutation.ts) | Runs the three phases and resolves with the mapped result. |
| `mutationFailurePhase(error)` | [`mutationFailure.ts`](../../studio/src/shared/apollo/declaredMutation/mutationFailure.ts) | `"write"`, `"refresh"` or `null`. |
| `useMutationState(execute, optimistic?, options?)` | [`useMutationState.ts`](../../studio/src/shared/apollo/declaredMutation/useMutationState.ts) | React mutation state over any executing function. `options.pendingScope` shares one pending count across hook instances through [`pendingScope.ts`](../../studio/src/shared/apollo/declaredMutation/pendingScope.ts). |
| `useDeclaredMutation(declaration)` | [`useDeclaredMutation.ts`](../../studio/src/shared/apollo/declaredMutation/useDeclaredMutation.ts) | `useMutationState` over `executeDeclaredMutation`. |

## Declaring a mutation

A declaration belongs to the feature that owns the document. Write the
operation in the feature's `operations/*.graphql`, run
`npm run graphql:generate --workspace @worktracker/studio`, and declare its
effects. Every member except `document`, `variables` and `root` is optional:

| Member | Meaning |
| --- | --- |
| `document` | The generated `TypedDocumentNode`. |
| `variables(args)` | Builds the document's variables from the caller's arguments. |
| `root` | The response field that holds the authoritative entity. |
| `result(entity, args)` | Domain mapping of the entity returned to callers. |
| `optimistic(args)` | The optimistic entity, or `undefined` to send without an optimistic layer. |
| `membership(cache, entity, args)` | List membership or order changes, applied with the optimistic and authoritative result. |
| `evict(args, entity)` | `{ __typename, id }` identities to remove; garbage is collected after the write commits. |
| `refresh(args, entity)` | The `refreshRead` entries that the committed write made stale. |
| `committed(entity, args)` | Runs exactly once per committed write, before the refresh phase. |
| `diagnostics` | `requested`, `written`, `refreshed` and `failed(phase, …)` hooks. |

The closest working example is the work-item details declaration in
[`workItemDetailsMutation.ts`](../../studio/src/features/work-items/internal/workItemDetailsMutation.ts).
It covers rename, description and type changes over
`UpdateWorkTrackerWorkItemDetailsDocument`. In outline:

```ts
export const workItemDetailsMutation = declareMutation({
  document: UpdateWorkTrackerWorkItemDetailsDocument,
  variables: ({ id, patch }: WorkItemDetailsEdit) => ({
    id: compactWorktrackerId(id),
    name: patch.name,
    description: patch.description,
    issueTypeId: patch.issue_type_id ? compactWorktrackerId(patch.issue_type_id) : undefined,
  }),
  root: "update_work_item",
  optimistic: ({ optimistic }) => optimistic,
  committed: (issue) => recordLocalWorkItemConvergence(issue.id, issue.updated_at),
  result: (issue) => workItemFromIssue(issue),
});
```

The declaration has no list membership change, so it declares no refresh. The feature's
public entry point stays a plain function: `updateWorkItem` in
[`mutationTransport.ts`](../../studio/src/features/work-items/mutationTransport.ts)
calls `executeDeclaredMutation(workItemDetailsMutation, …)`, so existing callers
keep their signatures. Domain behavior stays in the feature. Here that is local
convergence, which is recorded on commit and consumed on the stream echo.

## Using the hooks

`useMutationState(execute, optimistic?, options?)` gives any executing function
React mutation state:

- `isPending` stays true across overlapping calls until every call settles,
  because it tracks a pending count rather than a boolean.
- `variables` holds the last call's arguments. `error`, `isError` and
  `isSuccess` describe the last outcome.
- `mutateAsync(args, callbacks?)` returns the result and rethrows the failure.
  `mutate(args, callbacks?)` swallows the rejection, so a fire-and-forget UI
  handler does not produce an unhandled rejection.
- Per-call `onSuccess`, `onError` and `onSettled` callbacks run when that call
  settles.
- The optional `optimistic` argument is `{ current(args), apply(current, args) }`.
  `current` reads the feature's cached entity, and `apply` builds the optimistic
  value from it. The hook passes that value to `execute` as its second argument.
  If nothing is cached, the value is `undefined` and the call is sent without an
  optimistic layer.
- The optional `options.pendingScope` names a pending scope. Every hook
  instance in one scope counts every call made in it, and the count is an
  Apollo local-state row. Use a scope when several surfaces own controls for
  the same write and one surface's write must disable the others.

`useDeclaredMutation(declaration)` is `useMutationState` over
`executeDeclaredMutation`. Pass a module-level declaration so its identity is
stable across renders. Features whose public entry point is a plain transport
function wrap it with `useMutationState` instead: every work-item hook in
[`work-items/mutations.ts`](../../studio/src/features/work-items/mutations.ts)
(rename, description, type, state, parent, blockers, reorder and create) and
`useReorderModule` in
[`projects/mutations.ts`](../../studio/src/features/projects/mutations.ts).

## Migrated writes

Every write below runs through `executeDeclaredMutation`. Each feature's public
entry point keeps its signature, so callers did not change. The runtime
`writeWorkTracker` route and the per-feature `graphQl(...)` error wrappers are no
longer used by any of these writes. New work-item, project or workflow writes are
added as declarations, never as hand-written `optimistic`, `update` or `refetch`
code next to one.

### Work items

[`work-items/mutationTransport.ts`](../../studio/src/features/work-items/mutationTransport.ts)
exposes seven writes. Each declaration is in `work-items/internal/`, and the
module-list refreshes come from
[`moduleListRefreshes.ts`](../../studio/src/features/work-items/internal/moduleListRefreshes.ts).
Every committed write except delete records local convergence for the stream
echo.

| Entry point | Declaration | Effects |
| --- | --- | --- |
| `createWorkItem` | [`workItemCreationMutation.ts`](../../studio/src/features/work-items/internal/workItemCreationMutation.ts) | Membership: appends the authoritative row to the exact module list and strips the optimistic row. Refreshes that module. |
| `updateWorkItem` (rename, description, type) | [`workItemDetailsMutation.ts`](../../studio/src/features/work-items/internal/workItemDetailsMutation.ts) | Optimistic edit only; no list changes, so no refresh. |
| `transitionWorkItem` | [`workItemTransitionMutation.ts`](../../studio/src/features/work-items/internal/workItemTransitionMutation.ts) | Refreshes the item's module. Diagnostics keep the story-move event names and payloads. |
| `reparentWorkItem` | [`workItemReparentMutation.ts`](../../studio/src/features/work-items/internal/workItemReparentMutation.ts) | Refreshes the caller's source modules plus the destination `module_id` the server returns. |
| `setWorkItemBlockers` | [`workItemBlockersMutation.ts`](../../studio/src/features/work-items/internal/workItemBlockersMutation.ts) | Synthetic blocker edges (built by the hook) while pending, then refreshes the item's module. |
| `reorderWorkItem` (quarantined) | [`workItemReorderMutation.ts`](../../studio/src/features/work-items/internal/workItemReorderMutation.ts) | Rank-between optimistic move from the hook. Rebalancing can change every sibling rank, so it refreshes the exact module list. |
| `deleteWorkItem` | [`workItemDeletionMutation.ts`](../../studio/src/features/work-items/internal/workItemDeletionMutation.ts) | Evicts the compacted identity and refreshes every declared module. |

### Projects

[`projects/mutationTransport.ts`](../../studio/src/features/projects/mutationTransport.ts)
runs project create, update and delete from
[`projectMutations.ts`](../../studio/src/features/projects/internal/projectMutations.ts).
Create and delete refresh the projects list, update also refreshes that
project's open query, and delete evicts the project identity. Onboarding
acknowledgement (quarantined), in
[`onboardingAcknowledgementMutation.ts`](../../studio/src/features/projects/internal/onboardingAcknowledgementMutation.ts),
converges the onboarding read from the authoritative row through `membership`
and sends no follow-up read.

Module-presentation reorder (quarantined), in
[`moduleReorderMutation.ts`](../../studio/src/features/projects/internal/moduleReorderMutation.ts),
supplies a domain order transform as `membership`:
[`moduleOrderTransform.ts`](../../studio/src/features/projects/internal/moduleOrderTransform.ts)
shows the planned order in the optimistic layer and on commit, and the project's
open query is refreshed. `useReorderModule` runs it through `useMutationState`
with the `module-reorder` pending scope, so the sidebar and the tab strip share
one pending signal. Its neighbour-mismatch retry is an explicit second declared
mutation, re-planned from an authoritative non-deduplicated read; it is never a
replay of a committed write.

Module tab visibility, in
[`moduleTabVisibilityMutation.ts`](../../studio/src/features/projects/internal/moduleTabVisibilityMutation.ts),
keeps the module's rank while it shows the new visibility optimistically, and
its `membership` replaces the module's presentation row in the project's open
query. The authoritative row is the whole change, so it declares no refresh.

### Workflows

[`workflows/mutationTransport.ts`](../../studio/src/features/workflows/mutationTransport.ts)
runs every issue-type, state and per-type workflow write. Each refreshes the
project's open query, which holds the workflow catalog: states, issue types and
every type's workflow settings.

- **Issue types and states**: create, update, delete and reorder, in
  [`issueTypeMutations.ts`](../../studio/src/features/workflows/internal/issueTypeMutations.ts)
  and
  [`stateMutations.ts`](../../studio/src/features/workflows/internal/stateMutations.ts).
  Deletes evict the identity. State delete also refreshes the project's items
  behind the editor's per-state counts, and still ignores `reassignTo`. Both
  reorders stay quarantined domain operations.
- **Per-type workflow writes**: start state, add, update and remove transition,
  remove state from workflow (quarantined), auto-start and subtree run, in
  [`workflowPolicyMutations.ts`](../../studio/src/features/workflows/internal/workflowPolicyMutations.ts).
  Each sends the caller's `workflow_revision`; a stale revision rejects as a 409
  `ApiError` and refreshes nothing.
- **Launch-binding upsert**, in
  [`launchBindingUpsert.ts`](../../studio/src/features/workflows/internal/launchBindingUpsert.ts),
  resolves provider, model and reasoning against the workflow catalog before it
  runs the declaration. Its variables builder omits every field the caller left
  out and sends cleared fields as cleared.

The workflow editor store keeps sequencing its action, notice, error and
project-switch guard around each call, and reads the refreshed cache instead of
reloading. On a 409 it still loads the latest settings and shows "Workflow
changed elsewhere. Latest settings loaded."

### Not migrated

Writes owned by other features (agents, terminals, worktrees, documents, run
now, settings and the provider catalog) keep their own transports; they can
adopt the module later. Sprint planning's plan mutation in
[`planMutation.ts`](../../studio/src/features/work-items/planMutation.ts) keeps
its per-id write claim, as the spec allows. The project store's
`createModuleForProjectWithError` creates a Module through the declared
work-item create, then reloads the project's modules itself and ignores a
failed reload. That reload is store sequencing around the write, not a refresh
copy inside a transport, and making it declared would turn a failed reload into
a rejected create.

## How it is tested

Tests drive only public behavior. They check the operations and variables that
reached the transport, what the real Apollo cache returns, the errors callers
receive, and the diagnostics recorded. They do not spy on Apollo methods.

The shared fixture is
[`scriptedGraphQlTransport.ts`](../../studio/src/test/scriptedGraphQlTransport.ts).
`installScriptedGraphQlTransport()` installs a Studio runtime whose
`graphql_execute` is scripted. The real Studio Apollo client, cache, error link,
revision-guard link and transport link stay in place. It records each operation
name and its variables in send order. A test scripts each operation with
`answer`, `answerNext`, `failNext(code)` or `holdNext()`; a held response is
released by the test, which simulates slow, concurrent and stale requests.
[`workItemCacheFixtures.ts`](../../studio/src/test/workItemCacheFixtures.ts)
supplies issue rows, module-list data, cache seeding and cache readers.

| Seam | Test | Coverage |
| --- | --- | --- |
| 1, transport (primary) | [`workItemDetailsEdits.test.tsx`](../../studio/src/features/work-items/workItemDetailsEdits.test.tsx) | Rename, description and type change through their public hooks, plus the `updateWorkItem` entry point: sent operations and variables, the optimistic edit while pending, the adopted authoritative row, rollback with the mapped `ApiError` status and its phase. |
| 1, transport (primary) | [`workItemCreationAndDeletion.test.tsx`](../../studio/src/features/work-items/workItemCreationAndDeletion.test.tsx) | Create through `useCreateWorkItem` and `createWorkItem`: exactly one row after the optimistic row resolves, convergence recorded, an unwatched module list refreshed to the server's rows, and rollback with the mapped `ApiError`. Delete through `deleteWorkItem`: the compacted identity evicted and absent after the refresh of every declared module, and a failed delete that keeps the row. |
| 1, transport (primary) | [`workItemStateParentAndBlockers.test.tsx`](../../studio/src/features/work-items/workItemStateParentAndBlockers.test.tsx) | Reparent through `useSetWorkItemParent`: a cross-module move refreshes the source and returned destination module once each, and a held pre-write module read that lands last cannot restore pre-write membership. Transition through `useSetWorkItemState` and `transitionWorkItem`: an older revision arriving last does not overwrite a newer one, a failed write rolls back and records `transition-failed`, a failed refresh keeps the committed row without re-sending, and story-move events keep their names and payloads. Blockers through `useSetWorkItemBlockers`: synthetic edges while pending, then the item's module refreshed. |
| 1, transport (primary) | [`workItemReorder.test.tsx`](../../studio/src/features/work-items/workItemReorder.test.tsx) | Reorder through `useReorderWorkItem`: the optimistic move, then every rebalanced sibling settled to its server rank; a failed module refresh that keeps the committed reorder, reports the `refresh` phase and never re-sends; rollback with no refresh when the write fails; duplicate neighbour ranks that skip only the optimistic move; and the optimistic-reorder failure diagnostic. |
| 1, transport (primary) | [`projectWrites.test.ts`](../../studio/src/features/projects/projectWrites.test.ts) | Project create, update and delete: the same payloads, the projects list (and, for update, the project's open query) refreshed from the server, delete evicting the identity, and failures that surface as the same 409, 404 and 503 `ApiError`s. |
| 1, transport (primary) | [`onboardingAcknowledgement.test.ts`](../../studio/src/features/projects/onboardingAcknowledgement.test.ts) | Onboarding acknowledgement: the same payload, the onboarding read converged (or joined) from the authoritative row with no follow-up read, and a 404 that leaves onboarding pending. |
| 1, transport (primary) | [`moduleReorder.test.tsx`](../../studio/src/features/projects/moduleReorder.test.tsx) | Module-presentation reorder through `useReorderModule`: the planned order while pending and the server's order after the project-open refresh, a neighbour-mismatch retry that sends exactly two reorders with the second carrying the re-planned neighbours, a refused reorder that rolls back with the toast, and one pending signal across two surfaces until overlapping reorders all settle. |
| 1, transport (primary) | [`issueTypeWrites.test.ts`](../../studio/src/features/workflows/issueTypeWrites.test.ts) and [`stateWrites.test.ts`](../../studio/src/features/workflows/stateWrites.test.ts) | Issue-type and state create, update, delete and reorder through their entry points: the same operation and variables as before, the workflow catalog refreshed into the cache, deletes that evict the identity, state delete that sends no reassignment and also refreshes the project's items, and a refused reorder that surfaces the same `ApiError` and refreshes nothing. |
| 1, transport (primary) | [`workflowEditorStateWrites.test.ts`](../../studio/src/features/workflows/workflowEditorStateWrites.test.ts) | The workflow editor store's state actions: created, updated and deleted notices, the state-catalog revision advance, delete reloads served only by the declared refreshes, the project-switch guard, and the optimistic state reorder that settles to the server's order or rolls back with its error. |
| 1, transport (primary) | [`workflowPolicyWrites.test.ts`](../../studio/src/features/workflows/workflowPolicyWrites.test.ts) | Every per-type workflow write through its entry point: the same operation and variables as before and the workflow catalog refresh, a `stale_revision` that rejects as a 409 `ApiError` and refreshes nothing, launch-binding upsert that resolves catalog identities (reading the catalog from the network when none is cached), omits left-out fields and sends cleared ones, and rejects an unknown provider, model or reasoning with the same message before sending. |
| 1, transport (primary) | [`workflowEditorPolicyWrites.test.ts`](../../studio/src/features/workflows/workflowEditorPolicyWrites.test.ts) | The workflow editor store's per-type writes: applied at the editor's revision and shown from the declared refresh with no second read, a stale revision that loads the latest settings and shows the conflict notice, any other failure on the control's error, and subtree-run capability synchronization from the refreshed workflow. |
| 2, shared module | [`executeDeclaredMutation.test.ts`](../../studio/src/shared/apollo/declaredMutation/executeDeclaredMutation.test.ts) | Phase order, refresh deduplication by query and variables, deduplication off for post-write reads, inactive-list refresh, phase-tagged failures, no re-send after a refresh failure, eviction with garbage collection, and a post-commit hook that runs exactly once. |
| 2, shared module | [`useMutationState.test.tsx`](../../studio/src/shared/apollo/declaredMutation/useMutationState.test.tsx) | Pending across overlapping calls and across hook instances sharing a pending scope, `mutate` versus `mutateAsync` rejection and callback order, and the "next ordinary mutation" demonstration: a new declaration built from a generated document and a short effects declaration gets every behavior with no other code. |
| Overhaul acceptance | [`overhaulWorkTrackerWriteRuntimeAcceptance.test.tsx`](../../studio/src/test/overhaulWorkTrackerWriteRuntimeAcceptance.test.tsx) (overhaul-74) | Work-item, project, state, issue-type and workflow writes reach the desktop GraphQL contract through Apollo as the expected operations, in order, each followed only by its declared reads. |
| Overhaul acceptance | [`overhaulMutationConvergenceAcceptance.test.tsx`](../../studio/src/test/overhaulMutationConvergenceAcceptance.test.tsx) (overhaul-467) | User-visible convergence: a cross-module move refreshes source and returned destination once each, an unwatched module list converges, a create appears once, a deleted identity stays gone, a rebalancing reorder settles every sibling, and a failed refresh keeps the saved write without re-sending it. |

Run the focused tests from the repository root with
`npm run test --workspace @worktracker/studio -- src/shared/apollo/declaredMutation src/features/work-items src/features/projects src/features/workflows`,
and the acceptance tests with `npm run test:overhaul --workspace @worktracker/studio`.
The full gates are listed in the
[spec](../plans/CODING-2728-mutation-cache-effects-spec.md#gates).
