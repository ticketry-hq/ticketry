# Frontend state and API contract — decision record

**Date:** 2026-08-04
**Origin:** CODING-142, reported as "Update task name in the task list when it
updates on the task details page"
**Method used:** [`../decision-making-method.md`](../decision-making-method.md)

This is the reasoning record, not the plan. The plan lives in the three specs
published on CODING-142 and its sub-tasks. Read this first when making any
further decision about Studio state or the WorkTracker API surface — it holds
the context those specs assume.

---

## 1. What was reported, and what was actually wrong

A Story renamed on the details page kept its old name in the Stories pane until
the module was reloaded.

The mechanism: `NameEditor` commits through `patchField({ name })` into
`issueStore.patchWorkItem`, which optimistically patches its own record map,
PATCHes, reconciles the response, and projects into three `work-items.*` query
entries. The Stories pane renders `row.task.name`, where `row.task` is a
**`TaskSummary`** — a separate, lossy re-shape of the record living in the
`["tasks", projectId, moduleId]` cache entry. `issueStore` contains **zero
references** to `tasksStore`. Nothing in the rename path touches the tree.

Counting where a work item's `name` was stored found **six holders**:

| Holder | Shape | Refreshed by a rename? |
| --- | --- | --- |
| `issueStore.workItemsById` | `Record<id, WorkItem>` | yes (canonical) |
| `["work-items","index"]` | the same map object, projected | yes (not a copy) |
| `["work-items","detail",id\|key]` | `WorkItemDetail { task, attachments }` | yes |
| `["work-items","children",parentId]` | `WorkItem[]` | only for the open item |
| `["work-items","project",pid,filters]` | `WorkItem[]`, one entry per filter shape | only the active backlog variant |
| `["tasks",pid,mid]` | `TaskSummary[]` + buckets | **no** |
| `["tasks",pid,"details",taskId]` | `TaskDetails { task: TaskSummary }` | **no** |

Three of seven entries refreshed. The Stories pane was simply the copy someone
noticed.

**Why state changes appeared to work.** The status feed calls
`tasksStore.reconcileTargetedTask`, which normalises a full record into the
tree. But the feed publishes *committed workflow-state moves only* — so the
tree self-heals for state and never for name, description, type or parent. The
apparent correctness of state edits was a coincidence of an unrelated
subsystem, and it hid the defect class for as long as it did because state is
what people change most.

## 2. Three layers, not one

**Layer 1 — the backend manufactures fragmentation.** The four work-item list
reads are nested subsets of the same rows, differing only by hide-flags:

```
listProjectWorkItems(archived + pathfind)   ⊇
  listProjectWorkItems(pathfind)            ⊇
    listModuleWorkItems(module)             ⊇
      listProjectWorkItems(parent = X)
```

No pagination exists anywhere on work-item reads; every list returns its full
result set, ordered server-side by `rank, sequence_id`. Because each distinct
filter object forms part of a request-keyed cache key, the client faithfully
stores four copies of overlapping row sets. A second generator: `getWorkItem`
returns `{ task, attachments }`, bundling an entity with a sub-collection —
and the route inventory shows **`attachments` has one write and zero reads**,
so the only way to read attachments is to re-fetch a record you already hold.
Seven hand-authored schemas describe one model, and no artefact anywhere lists
reads and writes per model.

**Layer 2 — the frontend compounds it.** Responses are mirrored from query
entries into zustand stores, and re-shaped into a lossy eighth representation
(`TaskSummary`, including a fabricated `{ name: "No state" }` for a null
state). Ordering and grouping logic reads record fields out of these copies.
Revision guards are duplicated: roughly ten comparison sites in `tasksStore`
mirror canonical twins in `issueStore`.

**Layer 3 — nothing enforced anything.** `studio/docs/adr/0006` states in the
past tense that `TaskSummary` was deleted "along with its fabricated
`{name: "No state"}`". It was not. `studio/CONTEXT.md` asserts that a record
"can never exist in two places and disagree with itself." It can, and this
ticket was the proof. Both prior overhauls added a correct new mechanism and
left the previous lineage alive behind a compatibility shim — because each was
scoped as *introduce the new thing* rather than *delete the old thing*, and
because nothing failed when the invariant broke.

The state layer measured at the time of this decision: 18 zustand stores
(6,530 lines) plus ~2,000 lines of query/cache modules, ~8,500 of 32,025
non-test lines; 205 non-test files importing a store or query module; 80 of 89
test files referencing one; a 26,714-line test suite.

## 3. Decisions

### 3.1 The frontend state layer is rebuilt, not migrated again

Two migrations had already been attempted. The evidence that both left the old
lineage alive was the deciding factor: a third migration scoped the same way
would produce a fourth lineage.

**Scope:** all server-state domains, and — following 3.2 — client state as
well.

### 3.2 Redux Toolkit and RTK Query become the single state layer

The Redux store is the **sole source of truth**. RTK Query, the status-feed
WebSocket, and mutations are all *writers* into it.

- Records live in entity slices.
- Membership and ordering live in list slices — `moduleTree[moduleId]`,
  `sections[moduleId][stateId]` — because they are server-derived but are not
  records.
- RTK Query is used for request lifecycle only (`isLoading`, `isFetching`,
  `refetch`), never as a data source. Its cache is request-keyed exactly like
  TanStack Query's, so records held there would reproduce the defect.
- Optimistic writes and `state_revision` ordering survive, as **one**
  implementation at the entity-upsert choke point rather than today's
  duplicated pair.

zustand (18 stores) and TanStack Query both leave the codebase. The
`tanstack-server-state` branch's migration is superseded rather than built on.

**Landing:** big bang on one branch, across 205 read sites and most of an
89-file suite. The cost was raised and accepted.

**This reverses an intermediate position.** Mid-session the orthodox pattern —
React Query owns server state, Redux owns client state, derive rather than
copy — was put forward and agreed to as the better premise, with an estimate
of ~2,500 lines deleted instead of ~8,500 rewritten. It was then reversed back
to Redux-as-truth after the backend contract decision. Anyone revisiting this
should know the orthodox option was understood, costed, and declined in favour
of a single inspectable store and independence from invalidation fan-out.

### 3.3 Enforcement is part of the design

Because prose invariants failed twice here, all of:

1. A **store-wide uniqueness test** — dispatch a rename, walk the entire
   serialised store, assert the old string appears zero times and the new one
   exactly once. Catches any slice that kept a copy, for any field.
2. An **endpoint-shape test** — no RTK Query cache entry contains record
   objects.
3. A **type-level prohibition** on holding record types outside the entities
   slice.
4. This record and the ADRs, so the *why* survives.

### 3.4 The backend adopts DRF for model CRUD, with RPC quarantined

The route inventory (44 operations) splits roughly evenly:

- **~22 model-shaped CRUD** operations — work-items (two list scopes,
  retrieve, two create scopes, update, delete), states, issue-types, projects,
  modules, attachments.
- **~21 domain RPC** operations — transitions ×3, reorder ×3, impact ×2,
  workflow settings, start-state, auto-start, subtree-run, launch-bindings ×3,
  capabilities ×2, review-findings, scope-context, workspace, acknowledge.

The CRUD half moves to `ModelViewSet` with `ModelSerializer` derived from the
models, so the model is the single shape and the seven hand-written work-item
schemas collapse. The RPC half is quarantined in a named module, so exceptions
are countable and conspicuous instead of hiding among 44 equally-bespoke
handlers.

The decisive argument was not DRF's plumbing but its *default*: representation
drift is currently the path of least resistance, and the `attachments`
anomaly — one write, zero reads — is drift that a nested router would have
prevented by simply generating the read endpoint.

`django-ninja` stays for the 28 async handlers in `apps/*` (terminals,
documents, runs, worktrees, execution), which drive tmux, watchers and
subprocesses. This is two lanes with genuinely different needs, not two
mechanisms in one lane. The WebSocket half needs no change at all: channels
consumers already live outside the API layer.

### 3.5 The read contract is fixed, not just restructured

DRF alone would not have removed the overlap; router conventions would produce
the same nested endpoints. So, explicitly:

- One canonical collection read per scope.
- Sub-collections get their own read endpoints — attachments first.
- Hide-flags stop being parameters the client varies, so they cannot form
  cache keys.
- A pagination policy is stated rather than absent.

SDKs (`worktracker-typescript-sdk`, `worktracker-sdk`) are regenerated and
`surfaces/worktracker-agent` updated in the same pass. This is a breaking
change and was accepted as such.

### 3.6 A per-model route registry with a conformance test

The artefact that did not exist: one declaration of reads and writes per model,
plus a test asserting the live route table matches it and that **no undeclared
route exists**. Roughly 50 lines, asserted against the route table rather than
the framework, so it survives a framework or language change.

This is the durable piece. DRF is an accelerator that makes the convention
cheap while Django lives; the registry and its conformance test are what
outlive it.

### 3.7 Testing: domain rules are the asset, shape tests are re-authored

The existing HTTP API tests cannot serve as the conformance harness, because
they **specify the defect** — they assert that several endpoints return
overlapping views of the same rows. On the frontend it is worse: 21 test files
construct `TaskSummary` fixtures, i.e. they assert the lossy copy exists.

- **Durable:** service-layer domain tests — transition gating, rank allocation
  and reorder races, sequence allocation, blocker cycles, archiving, scoped
  workflow impact. The services are not changing, only their exposure.
- **Re-authored:** everything asserting interface shape. Backend contract
  tests become parameterised over the registry, with responses validated
  against the generated schema, so the suite *cannot* encode overlap. Frontend
  tests collapse to one seam — mount real UI, mock HTTP, assert the DOM — with
  no reference to any store or cache.
- **Deliberately implementation-aware:** the two enforcement tests in 3.3.

CODING-142's own regression test lives at the frontend seam and is
library-agnostic: mount the Stories pane and the details pane, rename through
the DOM, assert the row text changes.

**Sequencing:** implementation and tests are rewritten together, with the
service-layer domain suite as the only automated net and user-visible behaviour
verified by hand. The alternative — writing the new suites first against
current code to keep a net — was presented and declined. Recorded so that if
regressions do surface across the 205 read sites, the cause is understood.

### 3.8 The Rust rewrite is re-opened, not cancelled

`WORKTRACKER_RUST_LLD.md` (766 lines, "design, not yet implemented") plans a
standalone loco.rs backend. Checked against the property being bought in 3.4:

| | ninja (today) | loco.rs (planned) | DRF (chosen) |
| --- | --- | --- | --- |
| Endpoint unit | free function + decorator | free handler + `Routes::new().add(…)` | ViewSet bound to a model |
| Response shape | 43 hand-written schemas | hand-written struct + `From<Model>` | `ModelSerializer` from the model |
| CRUD by default | no | generator emits once, then free-form | yes, structurally |
| Per-model inventory | none | none | `router.urls` |

loco.rs sits on the *ninja* side of that line: the convention lives in its
scaffold generator, not in the type system, and the idiomatic serialization
pattern is hand-written response structs — which is how seven work-item shapes
appeared in the first place. So the rewrite as designed would regress the exact
property DRF is being adopted for.

Decision: adopt DRF, build the portable registry and conformance test, and
revisit the Rust project after living with a structured Django worktracker. If
maintenance stops hurting, the strongest motivation weakens; if Rust still
wins, the properties that must be reproduced are now named.

### 3.9 Amendment: filters narrow one collection; records have one home

The implementation keeps one work-item collection route and makes `project`,
`module`, and `state` declared filters on that route. Archived and PathFind
visibility remain declared server-side filters. A filter is membership in a
result set, not a new representation and not another endpoint; attachments are
a separate sub-collection because they are separate rows.

Every response is merged by id into the same normalized record store. Request
keys may retain loading state and collection membership, but they must not own
record objects. This amendment replaces the earlier wording that implied no
client-varied filters at all: filters are permitted, overlapping record homes
are not. The endpoint-shape and store-wide uniqueness checks enforce that
distinction.

## 4. Rejected, with reasons

**GraphQL with a normalizing client (Apollo/urql).** The correct diagnosis —
a normalizing cache keyed by entity id is exactly the missing property, and it
makes a second copy impossible rather than merely forbidden. Rejected because
it means a second API surface kept consistent with the REST one that
`surfaces/worktracker-agent` and both SDKs use, and because the backend it
would be built on is slated for replacement. Recorded so it is not re-proposed
without new information. Note for the future: `async-graphql` is mature on the
Rust side, and `seaography` generates a schema directly from SeaORM entities —
if GraphQL returns, that is where it belongs.

**normy over TanStack Query.** Auto-syncs the existing copies with almost no
code and no read-site changes. Rejected because it keeps the copies, cannot
move rows between lists on a state change, has no concept of `state_revision`
so it applies stale responses, and above all is another mechanism added beside
the old ones — the exact move that failed twice.

**Sync engine / local replica (Zero, Electric, Replicache).** Optimistic
mutation and multi-writer rebase as a library guarantee, and Postgres is
already the backing store. Rejected as disproportionate: it reshapes the
backend contract and stops the frontend reading through the generated SDK.

**"Always local, so drop the concurrency machinery."** Considered and rejected
on the facts: the client is built for a remote, authenticated server, and
agents write concurrently through MCP while a user edits. Multi-writer
convergence is real independent of latency, so optimistic writes and revision
ordering stay.

**DRF everywhere.** Would convert 28 async handlers driving tmux, watchers and
subprocesses to sync. Wrong direction for exactly the surfaces that need async.

**Keeping ninja with a bespoke registry and test.** Cheaper, and it delivers
the inventory and the enforcement without regenerating SDKs. Rejected because
the convention would be a house rule, and house rules are what did not hold
here — though note the registry and conformance test were kept from this option
and are now the durable artefact of 3.6.

**A `(module, state)` list endpoint.** Proposed for per-section pagination and
independently invalidatable sections. Correct instinct, and it composes well
with id-lists — but roots-only breaks three features that currently get
descendants free (collapsed-branch subtree chicklets, cross-descendant search,
live-terminal cycling revealing collapsed ancestors), and the single module
read already returns every descendant. Deferred; worth revisiting alongside the
pagination policy in 3.5.

## 5. Open questions

- **The terminal boundary.** `sessionStore` holds only session metadata —
  terminal bytes live in the xterm instances and the WebSocket transport, never
  in a store. That means "everything in Redux" is safe here, but the line needs
  stating explicitly in the frontend spec so nobody routes stream frames
  through reducers.
- **Persisted client state.** Which of the current `uiStore` values keep their
  localStorage contract, and which are re-derived on load.
- **Pagination policy.** No work-item read paginates today. The threshold and
  the shape need deciding as part of 3.5, and it interacts with the deferred
  `(module, state)` endpoint.
- **Whether Rust survives 3.8**, and if so which properties from 3.4 and 3.6
  it must reproduce.

## 6. Invariants this establishes

1. A record exists in exactly one place. Everything else holds ids.
2. Membership and ordering are server-derived and stored as ids, never as
   records.
3. Every endpoint is declared in the per-model registry; undeclared routes fail
   the build.
4. A model has one serialized shape, derived from the model.
5. Sub-collections are read through their own endpoints; no read bundles an
   entity with a collection.
6. Non-CRUD operations are quarantined in a named place, so they stay
   countable.
7. Every invariant above has a mechanism that fails when it breaks. Prose is
   not a mechanism.
