# Spec — WorkTracker API: model-shaped CRUD, fixed read contract, declared routes

## Problem Statement

Nobody can answer the question "how many ways can this model be read or
written?" There is no artefact that lists reads and writes per model, so the
answer is only discoverable by reading 44 hand-authored endpoint functions.

Because every endpoint is a free-form choice, the same model is described by
seven different hand-written schemas, and the surface has drifted in ways nobody
decided:

* Four work-item list reads return **nested subsets of the same rows**,
  differing only by hide-flags. Anything caching by request shape therefore
  accumulates several copies of overlapping row sets — which is the direct cause
  of the Studio bug where a renamed Story kept its old name in the list.
* Attachments have a write endpoint and **no read endpoint**. Reading them is
  bundled into the single-work-item read, so a client that already holds a
  record must re-fetch it to see its attachments.
* No work-item read paginates. Every list returns its full result set.

The long-term cost is maintenance: representation drift is the path of least
resistance, so it keeps happening, and each new consumer discovers a slightly
different shape of the same model.

## Solution

The CRUD half of the surface becomes model-shaped by construction: views bound
to models, serializers derived from models, so a model has one serialized shape
and adding a field flows through instead of being hand-copied into seven places.

The non-CRUD half — transitions, reorder, impact previews, workflow settings,
capabilities, acknowledgements — moves into a named quarantine, so exceptions are
countable and conspicuous rather than indistinguishable from CRUD.

The read contract is fixed so it can no longer manufacture duplicate client
state: one canonical collection read per scope, sub-collections read through
their own endpoints, hide-flags no longer varied by callers, and a stated
pagination policy.

And a per-model route registry becomes the artefact that answers the opening
question, with a test that fails when the live route table disagrees with it —
including when an undeclared route appears.

## User Stories

1. As a backend maintainer, I want one declaration listing every read and write
   per model, so that I can see the whole surface without reading every handler.
2. As a backend maintainer, I want an undeclared route to fail the build, so
   that the surface cannot grow by accident.
3. As a backend maintainer, I want serializers derived from models, so that a
   model change cannot silently leave one representation behind.
4. As a backend maintainer, I want one serialized shape per model, so that
   consumers stop discovering variants of the same record.
5. As a backend maintainer, I want non-CRUD operations gathered in one named
   place, so that I can see at a glance how much of the surface is exceptional.
6. As a backend maintainer, I want adding a standard CRUD endpoint to require no
   bespoke code, so that the conventional path is also the cheapest path.
7. As a frontend developer, I want exactly one canonical read per collection per
   scope, so that I cannot end up holding the same record under two cache keys.
8. As a frontend developer, I want to read a work item's attachments without
   re-reading the work item, so that holding a record is sufficient to render it.
9. As a frontend developer, I want narrowing (archived, pathfind, by-parent) to
   be something I do to data I already hold, so that filters cannot fragment my
   cache.
10. As a frontend developer, I want response shapes that match the model
    exactly, so that I never need a client-side re-shape of a server record.
11. As an agent author using MCP, I want the tool surface regenerated from the
    same contract the UI uses, so that agents and the UI cannot disagree about
    a record's shape.
12. As an SDK consumer, I want the generated client to expose one obvious read
    per collection, so that picking the wrong variant is not possible.
13. As a maintainer, I want the pagination policy stated, so that a large
    project's list does not silently become a performance problem.
14. As a maintainer, I want the domain rules (transitions, ranking, sequence
    allocation, blockers, archiving) untouched by this change, so that the risk
    is confined to the interface.
15. As a maintainer, I want the async surfaces (terminals, documents, runs,
    worktrees, execution) left alone, so that streaming and subprocess handling
    keep their async model.
16. As a maintainer, I want the WebSocket consumers untouched, so that live
    behaviour carries no risk from an HTTP-layer change.
17. As a reviewer, I want to see which read-contract changes are intentional
    breaks, so that I can distinguish them from accidental regressions.
18. As a future maintainer on a different stack, I want the route registry and
    its conformance test to be portable, so that the convention survives a
    framework or language change.
19. As a maintainer, I want the workflow gate's structured rejection preserved
    exactly, so that the UI keeps explaining *why* a state move was refused.
20. As a maintainer, I want authentication applied uniformly across the new
    views, so that adding a framework does not open an unauthenticated surface.
21. As a maintainer, I want a work item's revision semantics unchanged, so that
    ordering guarantees for concurrent writers still hold.
22. As a maintainer, I want the registry to record *why* each domain operation
    is exceptional, so that a future reader does not "tidy" a deliberate one
    into CRUD.

## Implementation Decisions

**Framework split.** Django REST Framework takes the model-CRUD operations —
work items, states, issue types, projects, modules, attachments — as model-bound
viewsets with serializers derived from the models. `django-ninja` retains the
async handlers in the terminals, documents, runs, worktrees and execution apps;
those drive tmux, file watchers and subprocesses, and DRF is sync-first. This is
two lanes with different needs, not two mechanisms in one lane. Channels
consumers already live outside the API layer and are untouched.

**Quarantine.** Domain operations that are not model CRUD live in a single named
module, separate from the CRUD viewsets: workflow transitions, reordering,
impact previews, workflow settings (start state, auto-start, subtree-run),
launch bindings, capability listings, scope context, review findings, workspace
read and onboarding acknowledgement. The registry records each one with a short
reason it cannot be CRUD.

**Read contract.**

* One canonical collection read per model per scope. Where two scopes are
  genuinely different questions (a module's subtree versus a project's
  work items), both may exist, but neither is a filtered variant of the other.
* `include_archived` and `include_pathfind` stop being parameters callers vary.
  Rows the caller may need are returned, and hiding is the caller's derivation.
* By-parent listing is removed as a read; children are derived from a
  collection the caller already holds.
* Attachments gain their own read endpoint, and the single-work-item read stops
  bundling them.
* Pagination policy is stated explicitly, including the threshold at which it
  applies and the response envelope. Absence of pagination is no longer an
  unexamined default.

**Route registry.** One declaration keyed by model, listing each read and each
write with its verb, path and purpose. A conformance test resolves the live
route table and asserts a two-way match: every declared route exists, and no
route exists that is not declared. It asserts against the route table rather
than the framework so it survives the framework being replaced.

**Schema conformance.** Responses are validated against the schema generated
from the serializers, so representation drift fails the build rather than being
caught by per-endpoint payload assertions.

**Preserved exactly.** Domain services and models are not touched — only their
exposure changes. The workflow gate's structured rejection keeps its human
`detail` plus machine `code`, `from` and `to`, because the UI renders that
`detail` and suppresses the no-op case from it. Revision semantics are
unchanged. Authentication is applied to the new views with the same static-token
check the current router applies, and its uniform application is asserted.

**Regeneration.** The TypeScript SDK, the Python SDK and the MCP agent surface
are regenerated and updated in the same change. This is a breaking change and is
released as one.

## Testing Decisions

A good test here asserts externally observable behaviour — HTTP status,
response body, persisted state — and does not reach into view or serializer
internals. Two categories, deliberately separated:

**Domain-rule tests are the asset and carry over untouched.** Workflow
transition gating, rank allocation and reorder races, sequence allocation,
blocker cycles, archiving cascade, state replacement, scoped workflow impact,
and workflow configuration services. These sit below the HTTP layer, they do not
care what the interface looks like, and they are what protects this change.
Prior art: the existing service-level and workflow-level test modules.

**Shape tests are re-authored, not preserved.** The existing HTTP API tests
assert that several endpoints return overlapping views of the same rows — they
specify the defect. They are replaced by tests parameterised over the route
registry: for each declared read, the response validates against the declared
schema; for each declared write, invalid input is rejected and valid input
persists; and no undeclared route resolves. That suite cannot encode overlap,
because the registry forbids it.

The quarantined domain operations keep hand-written tests, because each is
genuinely bespoke.

Implementation and tests are rewritten together, with the domain-rule suite as
the automated net and interface behaviour verified by hand. This was a
deliberate choice over writing the new suites first; it is recorded because it
is where regression risk sits.

## Out of Scope

* Any change to models, migrations, or domain services.
* The async apps: terminals, documents, runs, worktrees, execution.
* WebSocket consumers and the status-feed protocol.
* Adding a `(module, state)` list endpoint for per-section pagination. Deferred;
  revisit with the pagination policy.
* GraphQL. Considered and rejected; see the backend ADR.
* The Rust rewrite. Re-opened as a question, not decided here.

## Further Notes

The route inventory that motivated this: 44 operations, roughly 22 model-shaped
CRUD and 21 domain RPC. The `attachments` anomaly — one write, zero reads — is
the clearest illustration of the underlying problem, because a nested router
would have generated that read endpoint without anyone deciding to.

DRF is an accelerator, not the guarantee. Its conventions make the model-shaped
default cheap while Django lives, but nothing in DRF prevents bespoke views. The
guarantee is the registry plus its conformance test, which is why those are
specified as portable.

This interacts with the Rust plan: `loco.rs` registers free-form handlers, has
no model-derived serializer analogue, and idiomatically hand-writes response
structs — so the rewrite as currently designed would regress the property this
spec buys. That is why the registry asserts against the route table.

Full reasoning, measurements and rejected alternatives:
`docs/decisions/2026-08-04-frontend-state-and-api-contract.md`.