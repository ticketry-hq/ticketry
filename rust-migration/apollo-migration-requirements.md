# Apollo Client migration — requirements

Status: draft for ticket creation
Depends on: nothing (frontend-only, plus one optional Rust entity change)
Related: `apollo-migration-lld.md` (low-level design), `apollo-cache-shape.html` (cache visualization)

## 1. Problem statement

The frontend hand-maintains a normalized cache on top of TanStack Query. The
module-tree query fans records into per-id cache entries, guarded by two
custom rules (a `state_revision` freshness check and a skip-while-mutating
check), while run status lives in a second store (Zustand) fed by the
`RunStatusStream` subscription and reconciled through bespoke invalidators.
This works, but the team maintains cache-consistency machinery that a
GraphQL-native normalized cache provides as framework behavior. Each new
entity that needs cross-view record sharing repeats the pattern.

Decision made: migrate frontend data fetching and caching from TanStack Query
to Apollo Client, using Apollo's normalized cache as the single frontend state
owner for server records, run status, and client-only state.

## 2. Goals

- G1. One normalized client cache holds all server entities; every entity
  exists exactly once, keyed by type + id, and every view re-renders from the
  same record.
- G2. Delete the hand-rolled normalization: the `byId` fan-out loop, the
  skip-while-mutating guard, and per-write-site revision checks.
- G3. Express the `state_revision` freshness rule once, as a declared merge
  policy on the work-item type.
- G4. Run status becomes cache-resident: `AgentRun` rows live in the same
  cache as work items; status chips and module chicklet counts read from it.
  The separate Zustand entity store is removed.
- G5. The snapshot/cursor/resync stream protocol is preserved unchanged on
  the wire; only its destination changes (cache writes instead of Zustand).
- G6. Authored `.graphql` operation documents are preserved verbatim.
  Codegen output format changes; the operations do not.
- G7. No user-visible behavior change. This is an infrastructure migration.
- G8. Client-only state lives in Apollo cache rows; no second application-state
  library remains beside the normalized server records.

## 3. Non-goals

- No backend/schema changes, with one narrow optional exception (R14).
- No REST compatibility layer; no change to the generated-first Seaography
  contract or the restricted-write seam.
- No change to the stream protocol, stall-deadline logic, or launch flows.
- No adoption of Apollo for the settings/profile config store if it is not
  GraphQL-backed.

## 4. Functional requirements

### Cache and reads

- R1. Apollo `InMemoryCache` is the only client-side store of server
  entities. `keyFields: ["id"]` (or equivalent) for every normalized type:
  work items, states, issue types, transitions, launch bindings, providers,
  agent models, reasoning levels, agent runs, graph runs, terminal sessions,
  worktrees, design documents.
- R2. Seaography connection wrappers (`{ nodes: [...] }`) are not normalized;
  they merge by replacement under their parent field + arguments.
- R3. Opening a module issues one GraphQL request (the module-load document)
  and fully populates the cache for first paint, matching today's single
  `WorkTrackerModuleTree` round trip.
- R4. The board tree is rebuilt client-side from `parentId`, exactly as
  today. No nested-tree resolver is added.
- R5. Task ordering remains rank + `sequence_id` tiebreak; module ordering
  keeps the two-mode canonical rule (`canonicalModuleOrder.ts`) untouched.

### Writes and consistency

- R6. Mutations select the full entity fragment; Apollo merges results into
  the normalized record automatically. No hand-written cache update for
  field-level edits.
- R7. Structural mutations (reparent, reorder, create, delete, archive)
  refetch or explicitly update every affected list, per the repository's
  convergence rule. Deletes evict the entity from the cache.
- R8. Optimistic updates use Apollo's optimistic layer. A concurrent refetch
  must not clobber an in-flight optimistic value (this replaces the
  skip-while-mutating guard). On mutation error the optimistic layer rolls
  back automatically.
- R9. A merge policy on the work-item type rejects any incoming snapshot
  whose `state_revision` is lower than the cached one. This is the only
  place the rule exists.
- R10. Domain error codes (`FoundationGraphQlError`, including
  `stale_revision`, `illegal_transition`, `conflict`) surface to callers with
  the same shape and semantics as today.

### Subscription and status

- R11. `RunStatusStream` keeps its wire protocol: snapshot frame on connect,
  ordered incremental events, cursor, resync (reconnect + fresh snapshot) on
  receiving an event for an unknown run. The handler writes into the Apollo
  cache instead of Zustand.
- R12. Status chips (`AgentStateBadge`), automation-failure chicklets, and
  module-tab lifecycle counts render from cache-derived data with no second
  entity store. Aggregations (counts per module) are derived at read time,
  not maintained as parallel state.
- R13. Project switch rebaselines status data (equivalent of today's
  `switchProject` store reset): stale runs from the previous project must not
  leak into the new project's views.

### Backend (optional, single item)

- R14. (Optional, recommended) Add the reverse `has_many` relation
  Issue → AgentRun so the module-load document can nest `agentRuns` per
  task for the initial snapshot. If deferred, runs remain a sibling root
  selection; the migration does not depend on this.

### Constraint carried from design review

- R15. No per-parent arguments on nested relation selections (`first: 1`,
  per-node `orderBy`, "latest run per task"). These break Seaography's
  dataloader batching into N+1 queries. "Latest per parent" needs are served
  by fetching the set and reducing client-side.

## 5. Migration process requirements

- M1. Feature-by-feature migration; TanStack and Apollo coexist during the
  transition, but a given entity type is read through exactly one of them at
  any phase boundary (no entity dual-read within a phase).
- M2. Authored `.graphql` files are not edited except where the design adds
  selections (e.g. module-load consolidation). Codegen switches output
  plugins; generated files are regenerated, never hand-patched.
- M3. Each phase lands green: `npm run typecheck`,
  `npm run test --workspace @worktracker/studio`, and the desktop E2E suite
  (`npm run test:e2e:desktop --workspace @worktracker/studio`).
- M4. TanStack Query, the `byId` fan-out, both guards, every Zustand store, and
  the invalidator classes are deleted by the final phase.
  Dead code (e.g. the never-called `AutomationAttempts` document) is removed
  along the way.

## 6. Non-functional requirements

- N1. Module-open latency does not regress measurably (backend is in-process
  SQLite; budget is render cost, not network).
- N2. No render storms: a single entity update re-renders only components
  reading that record (Apollo fragment watching), matching or improving
  today's per-id subscription granularity.
- N3. Cache memory stays bounded: switching projects evicts or resets data
  from the previous project's runs (mirrors today's store rebaseline).
- N4. Merge policies and the subscription cache-writer have direct unit
  tests, including: stale-revision rejection, optimistic-vs-refetch layering,
  unknown-run resync trigger, and project-switch rebaseline.

## 7. Acceptance criteria

- A1. Grep-level absence: no `@tanstack/react-query` import remains; the
  skip-while-mutating predicate and per-site revision checks are gone.
- A2. The `state_revision` rule exists in exactly one module (the type
  policy) with unit tests.
- A3. Status chips update end-to-end from a stream event with Zustand's
  entity store deleted (selector-shim layer allowed only as a temporary
  phase artifact, removed by final phase).
- A4. Behavioral parity: drag-to-state with a slow mutation shows the
  optimistic value until settle; a stale module refetch never regresses a
  newer record; killing and restarting the stream produces a correct
  repaint via snapshot; an event for an unknown run triggers resync.
- A5. All three validation commands green, and the desktop E2E suite passes
  on real data (isolated Rust database via `MUXED_DATA_DIR`).
- A6. Browser runtime degrades exactly as today: no status stream, queries
  still work through the web adapter.

## 8. Risks

- K1. Apollo's optimistic layering differs subtly from the current guard
  (which also shields against *other* queries' writes). Mitigate with N4
  tests written before the guard is deleted.
- K2. Aggregate chicklet counts move from maintained Zustand state to
  read-time derivation; a naive implementation could re-derive per render.
  Mitigate with memoized cache watchers (LLD §7).
- K3. Two caches coexist mid-migration. M1's single-reader rule prevents
  split-brain, but ordering of phases matters; work items migrate first
  because everything reads them.
- K4. The stream currently drives TanStack invalidators for work items,
  documents, and worktrees. Those must be ported to Apollo refetch/eviction
  in the same phase that migrates each entity, or updates silently stop.
- K5. Pre-existing red tests on this branch (Django-fixture tests, retired
  REST frontend tests) must not be attributed to this migration; baseline
  them before phase 1.
