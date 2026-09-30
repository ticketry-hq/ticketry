# Apollo Client migration — low-level design

Status: draft for ticket creation
Companion: `apollo-migration-requirements.md`

## 1. Current architecture (what is being replaced)

Facts verified in this codebase, with the load-bearing files:

- **Transport.** All GraphQL executes over Tauri IPC: a taurpc
  `GraphQlTransportProxy` whose `graphql_execute(jsonString)` takes
  `{query, operationName, variables}` and returns a JSON-encoded
  `{data, errors}` (`src/graphql-foundation/foundationClient.ts:177-205`).
  Domain errors map to `FoundationGraphQlError` with a closed code union.
  The browser runtime uses the web GraphQL adapter; its
  `statusStreamTransport()` returns `null` (`runtime/browserRuntime.ts:102`),
  so the browser has no status stream.
- **Cache.** TanStack Query. The module-tree query stores structure only
  (`rootIds`, `children`, `order`) under `tasks.byModule`, and fans each
  work-item record into `workItems.byId(id)` with two guards: skip if a
  local mutation for that id is in flight, and never overwrite a record with
  a higher `state_revision` (`features/work-items/queries/index.ts:58-86`).
  Rows subscribe per-id (`useWorkItem`, `useWorkItemsByIds`).
- **Status.** `RunStatusStream` subscription, started once per project in
  `StudioShell`, feeds a Zustand store (`useAgentStatusStore`): snapshot
  frame (`runs[]`, `automation_attempts[]`), incremental events, resync on
  unknown run (`features/agents/status/stream/statusStreamFeed.ts`). The
  feed also drives `WorkItemInvalidator` / `DocumentInvalidator` /
  `WorktreeInvalidator` (TanStack invalidations) and `startStallDeadlines()`.
- **Catalogues.** `WorkTrackerWorkflowCatalog` fetched lazily on
  detail-pane mount, deduped through one cache entry per project
  (`features/workflows/queries/catalogTransport.ts`).
- **Codegen.** Authored `.graphql` documents per feature
  (`features/<domain>/operations/*.graphql`) generate typed clients into
  `features/<domain>/generated/` via `npm run graphql:generate`;
  `graphql:drift` verifies freshness.

## 2. Target architecture

```
┌────────────────────────────────────────────────────────────┐
│ React components                                           │
│   useQuery / useMutation / useFragment (Apollo hooks)      │
├────────────────────────────────────────────────────────────┤
│ ApolloClient                                               │
│   InMemoryCache (normalized: Type:id rows)                 │
│     • typePolicies: keyFields, WorktrackerIssue merge      │
│       (state_revision rule), connection replacement merge  │
│   Links: errorLink → splitLink(subscription? streamLink    │
│                                : taurpcHttpLink)           │
├────────────────────────────────────────────────────────────┤
│ Transport (unchanged)                                      │
│   taurpc GraphQlTransportProxy.graphql_execute  (ops)      │
│   statusStreamTransport proxy                   (stream)   │
└────────────────────────────────────────────────────────────┘
```

One store, and one *writer discipline*: network results, mutation results,
and stream events all write into the same cache through declared policies.
The optimistic layer sits above it; refetches land underneath it.

## 3. New modules

Per the repository's layout rules, the Apollo plumbing is cross-feature and
lives in a dedicated folder; each file stays single-purpose.

```
studio/src/shared/apollo/
  client.ts             # ApolloClient construction, link chain assembly
  taurpcLink.ts         # terminating ApolloLink over graphql_execute
  errorLink.ts          # GraphQL error → FoundationGraphQlError mapping
  streamLink.ts         # subscription link over statusStreamTransport
  typePolicies.ts       # keyFields per type + connection field policies
  issueMergePolicy.ts   # the state_revision merge function (one place)
  cacheKeys.ts          # possibleTypes / typename constants
```

### 3.1 `taurpcLink.ts`

A terminating `ApolloLink`. For each operation:

```ts
new ApolloLink((operation) =>
  new Observable((observer) => {
    createProxy().graphql_execute(JSON.stringify({
      query: print(operation.query),
      operationName: operation.operationName,
      variables: operation.variables,
    }))
      .then((encoded) => {
        observer.next(JSON.parse(encoded)); // {data, errors} passes through
        observer.complete();
      })
      .catch((e) => observer.error(e));
  }))
```

Notes:
- `print()` cost is avoided by caching the printed document per operation
  (Apollo's `operation.query` is a stable AST; memoize with a WeakMap).
- The proxy factory is injected from the runtime contract
  (`runtime/contract.ts`), so browser and desktop share the link with
  different proxies, same as `executeFoundationOperation` today.

### 3.2 `errorLink.ts`

`onError` link translating `graphQLErrors[0].extensions.code` through the
existing `knownCode` mapping and rethrowing `FoundationGraphQlError`, so
every current `catch` site (e.g. `stale_revision` handling, launch error
remedies) keeps working unchanged. The code union and `knownCode` move from
`foundationClient.ts` into this module when `foundationClient.ts` retires.

### 3.3 `streamLink.ts`

A non-terminating concern, deliberately **not** implemented as a generic
Apollo subscription link. The stream is one protocol with one consumer; the
existing `statusStreamFeed` structure is kept (start/stop keyed on project,
snapshot handling, cursor, resync, stall deadlines) and only its *sink*
changes from Zustand writes to cache writes (§7). Rationale: wrapping the
proxy in `Observable`-per-operation machinery buys generality no second
subscription needs, and the resync semantics (imperative reconnect) fit the
feed object better than a link.

If a second GraphQL subscription ever appears, revisit with a real split
link; the decision is contained in this one module.

### 3.4 `typePolicies.ts`

```ts
{
  WorktrackerIssue:      { keyFields: ["id"], fields: issueFieldPolicies },
  WorktrackerState:      { keyFields: ["id"] },
  WorktrackerIssuetype:  { keyFields: ["id"] },
  WorktrackerIssuetypetransition: { keyFields: ["id"] },  // i64 id
  WorktrackerLaunchbinding:       { keyFields: ["id"] },  // i64 id
  WorktrackerProvider:   { keyFields: ["id"] },
  WorktrackerAgentmodel: { keyFields: ["id"] },
  WorktrackerReasoninglevel: { keyFields: ["id"] },
  AgentRuns:             { keyFields: ["id"] },
  GraphRuns:             { keyFields: ["id"] },
  Worktrees:             { keyFields: ["id"] },
  DesignDocuments:       { keyFields: ["id"] },
  // Seaography connection + edge wrappers: NOT normalized.
  // They have no id; default replacement merge is correct because the
  // repository convergence rule refetches lists on membership change.
}
```

Exact `__typename` strings must be read from the generated SDL during
implementation (Seaography's naming, e.g. whether the object type is
`WorktrackerIssue` and the connection `WorktrackerIssueConnection`); the
table above fixes the *policy*, codegen fixes the spelling. Every authored
document must select `id` (and codegen adds `__typename`) on every entity —
enforced by a lint/codegen check, since a missing `id` silently disables
normalization for that selection.

### 3.5 `issueMergePolicy.ts` — the one revision rule

```ts
// R9: never let an older snapshot of an issue overwrite a newer one.
// existing/incoming are normalized refs; read stateRevision via readField.
merge(existing, incoming, { readField, mergeObjects }) {
  if (existing === undefined) return incoming;
  const cur = readField<number>("stateRevision", existing);
  const inc = readField<number>("stateRevision", incoming);
  if (cur !== undefined && inc !== undefined && inc < cur) return existing;
  return mergeObjects(existing, incoming);
}
```

Registered as a type-level merge on `WorktrackerIssue`. Unit-tested directly
against an `InMemoryCache` instance (no React) with the three cases: newer
wins, equal merges, older rejected. This deletes the guard at
`queries/index.ts:75-81` and every future write site.

## 4. Codegen changes

- Switch generation for operations from the current client-wrapper output to
  `TypedDocumentNode` artifacts (`typescript`, `typescript-operations`,
  `typed-document-node` plugins), preserving per-feature output locations
  (`features/<domain>/generated/`).
- `addTypename: true` (codegen default) so normalization works.
- Authored `.graphql` files unchanged except the module-load consolidation
  (§6). Scalar mappings and the drift check (`graphql:drift`) carry over.
- The generated hooks are Apollo's own (`useQuery(Document)`); no bespoke
  client wrappers remain.

## 5. Query layer mapping (per current call site)

| Today (TanStack) | Target (Apollo) |
| --- | --- |
| `moduleTreeQuery` fan-out + structure entry | `useQuery(ModuleLoadDocument)`; structure derived from the result's ref list via existing `moduleTreeFromWorkItems`; fan-out loop deleted |
| `useWorkItem(id)` / `useWorkItemsByIds` per-row cache reads | `useFragment({fragment: WorkItemFields, from: {__typename, id}})` — row-granular re-renders without a query |
| `setStatesSorted` priming states into a shared key | gone; states are normalized rows plus the module-load result list |
| `catalogTransport` dedupe of the workflow catalogue | gone; Apollo dedupes identical in-flight queries natively; catalogue moves into project-open document (§6) |
| `queryClient.invalidateQueries` from invalidators | `client.refetchQueries({include: [...]})` or targeted `cache.evict` per entity (§7) |
| mutation `onSuccess` writing returned entity into `byId` | automatic normalized merge of the mutation result (R6) |
| optimistic updates + skip-while-mutating | `optimisticResponse` on the mutation; layering handles refetch races (R8) |
| delete mutations + list eviction | `cache.evict({id: cache.identify(...)})` + `cache.gc()` + list refetch |

Structural convergence (R7) stays a deliberate, per-mutation decision
exactly as the repository rules require; Apollo does not change *when* to
refetch, only removes the record-merge half of the work.

## 6. Document consolidation (folded into the migration)

Two authored documents replace today's scattered fetch timing; both are
pure `.graphql` edits over the existing generated schema:

- **Project-open document**: project row (incl. `manualModuleOrder`),
  modules list, states, issue types (+ `transitions`, `launchBindings`),
  providers → agent models → reasoning levels. Kills the
  `WorkTrackerProjects` refetch-per-module-load and the lazy catalogue
  fetch on first detail-pane open.
- **Module-open document**: module row + `moduleMembers` (flat tasks with
  one-hop `state`, `issueType`, blocker edges, children ids), ordered by
  rank server-side. If R14 (Issue → AgentRun `has_many`) lands, add nested
  `agentRuns` as the status seed; otherwise a sibling root selection.
- Constraint R15 applies: no per-parent arguments on any nested relation.

## 7. Status stream → cache (the Zustand absorption)

The feed keeps its protocol obligations and swaps its sink:

- **Snapshot frame** → `cache.writeQuery` of a local-only
  `projectRunStatus(projectId)` query whose result is the run list
  (normalized `AgentRuns` rows) + `automation_attempts`. Writing the
  snapshot replaces rebaselining: the list is replaced wholesale, and
  `cache.gc()` after project switch drops unreachable runs (N3, R13).
- **Incremental event** → `cache.writeFragment` on the `AgentRuns` row
  (state, effectiveState, launchState, outputSequence...). Chips using
  `useFragment` on that row re-render; nothing else does (N2).
- **Unknown run in an event** → unchanged resync: reconnect, fresh
  snapshot. The aggregate-correctness argument requires completeness, so
  lazy per-run fetch is explicitly rejected.
- **Aggregations** (module-tab lifecycle counts, per-task chip selection
  currently in Zustand selectors): become pure functions over the
  `projectRunStatus` watched query result, memoized per module id. One
  hook, `useModuleLifecycleCounts(moduleId)`, replaces
  `selectModuleLifecycleCounts`; `useTaskAgentLifecycle(taskId)` replaces
  the per-task selectors. Both live in `features/agents/status/`.
- **Stall deadlines** (`startStallDeadlines`): unchanged logic; its writes
  become fragment writes marking the run row stalled.
- **Invalidators**: `WorkItemInvalidator` → `client.refetchQueries` of the
  module-load document (or entity fragment write when the event carries the
  entity); document/worktree invalidators likewise, ported in the phase
  that migrates each entity (K4).
- Client-only UI state occupies local Apollo cache rows behind focused selector
  adapters. No second application-state owner remains.

## 8. Client assembly and runtime split

`shared/apollo/client.ts`:

```ts
const client = new ApolloClient({
  link: from([errorLink, taurpcLink(runtime.graphqlTransport)]),
  cache: new InMemoryCache({ typePolicies }),
  defaultOptions: {
    watchQuery: { fetchPolicy: "cache-first" },
    query:      { fetchPolicy: "network-only" }, // imperative loads mirror staleTime: 0
  },
});
```

- Module-open uses `fetchPolicy: "cache-and-network"` to preserve today's
  `staleTime: 0` behavior (always revalidate, paint from cache instantly).
- Browser runtime: same client, browser proxy, no stream (`streamLink`
  never started when `statusStreamTransport()` is null) — A6.
- Imperative access outside React (`clientStore.ts` flows like
  `selectModule`) uses `client.query` / `client.readQuery` directly; the
  exported singleton mirrors today's `queryClient` usage.

## 9. Migration phases

Each phase lands independently green (M3); an entity type is read through
exactly one cache per phase (M1).

**Phase 0 — infrastructure (no consumer changes).**
Apollo deps; `shared/apollo/` modules; codegen switched to
TypedDocumentNode (both stacks can consume these documents, which is what
makes coexistence safe); typePolicies + merge policy with unit tests (N4
written *now*, against the policies, before any guard is deleted).

**Phase 1 — work items + projects + workflows (the read core).**
Module-open and project-open documents (§6); board, tabs, picker, detail
pane read through Apollo (`useFragment` rows); work-item mutations move
with `optimisticResponse`; fan-out loop, both guards, `setStatesSorted`,
`catalogTransport` deleted. TanStack still owns: status invalidation
targets (temporarily pointed at Apollo refetch by a thin adapter),
attachments, settings, execution reads.

**Phase 2 — status stream absorption.**
§7 in full: feed sink → cache, aggregate hooks, Zustand entity store and
selector layer deleted, invalidators become Apollo refetch/eviction.
The sync-engine question ("events as the only writer") is decided here in
Apollo terms: events write fragments; queries exist for load and resync.

**Phase 3 — the long tail.**
Attachments, documents, worktrees, execution/graph-run reads, settings (if
GraphQL-backed) migrate mechanically. Dead code swept (unused
`AutomationAttempts` document).

**Phase 4 — removal.**
`@tanstack/react-query` and Zustand uninstalled; `foundationClient.ts` retired
into `errorLink`; grep gate A1; full validation suite + desktop E2E on the
isolated real-data database.

## 10. Testing strategy

- **Policy unit tests** (Phase 0): `InMemoryCache` instances exercising the
  revision merge (3 cases), connection replacement, eviction + gc after
  project switch.
- **Layering tests** (Phase 1): jsdom tests driving `client.mutate` with
  `optimisticResponse` while a mocked refetch resolves mid-flight; assert
  the optimistic value is visible throughout and the settle result wins
  (replaces the deleted guard's coverage — K1).
- **Stream tests** (Phase 2): feed unit tests with a scripted transport:
  snapshot paint, event fragment write, unknown-run → resync, project
  switch rebaseline (existing `statusStreamFeed` tests adapted to the new
  sink).
- **E2E**: the desktop Playwright suite per phase; it already covers board
  interactions and status chips end-to-end.
- **Baseline**: record currently-red tests before Phase 0 (K5) so
  regressions attribute cleanly.

## 11. Explicitly rejected alternatives

- **urql + graphcache**: lighter, but weaker optimistic layering and a
  smaller ecosystem; the optimistic layer is the single biggest guard
  deletion, so Apollo's mature implementation wins.
- **Generic Apollo subscription link for the stream**: rejected in §3.3;
  resync is imperative and single-consumer.
- **Nested-tree resolver / recursive fetch**: rejected earlier in design;
  flat-by-module with client grouping stays (R4).
- **Lazy per-run fetch instead of resync**: rejected; aggregate counts
  require completeness over a lossy transport (§7).
