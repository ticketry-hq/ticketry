# Spec — One record, one shape: API contract and Studio state layer

Umbrella spec. The two halves are specified separately and are separately
implementable, but they are one problem and must not be reasoned about apart —
that separation is how the defect survived two attempts to fix it.

Originally reported as "Update task name in the task list when it updates on
the task details page", the rename is one symptom of the defect this fixes and
its regression test is the clearest statement of done.

* `spec-backend.md` — model-shaped CRUD, fixed read contract, declared routes
* `spec-frontend.md` — Studio state rebuilt with an enforced single-copy invariant

## Problem Statement

A work item's field values are stored in six different places in Studio, and an
edit refreshes three of them. Renaming a Story on the details page leaves the old
name in the Stories pane, in search, and in the pickers, until the module is
reloaded.

That is the visible half. The invisible half is that the API *manufactures* the
duplication: four work-item list reads return nested subsets of the same rows,
differing only by flags that hide rows. Anything caching by request shape
therefore holds several copies of overlapping row sets — correctly, by its own
rules. Separately, attachments have a write endpoint and no read endpoint, so
reading them means re-fetching a record the client already holds, producing yet
another copy. One model is described by seven hand-written schemas, and no
artefact anywhere states how many ways a model can be read or written.

And the third layer: nothing enforced any of this. A decision record states in
the past tense that the lossy client-side re-shape was deleted; it was not. The
glossary asserts a record can never exist in two places and disagree with
itself; it can, and this ticket is the proof. Two previous overhauls each
introduced a correct new mechanism and left the previous one alive behind a
compatibility shim, because each was scoped as *introduce the new thing* rather
than *delete the old thing*, and because no build ever failed when a duplicate
appeared.

Fixing only the frontend leaves the API still handing out overlapping views.
Fixing only the API leaves the client still mirroring responses into stores and
re-shaping them lossily. Fixing both without enforcement produces a third
correct mechanism beside two dead ones — which is the documented history of this
codebase.

## Solution

**One record, one shape, one place, enforced.**

*Server side:* a model has one serialized shape, derived from the model. One
canonical collection read per scope, so no two reads return overlapping row
sets. Sub-collections are read through their own endpoints, so no read bundles an
entity with a collection. Non-CRUD operations are quarantined in a named place so
they stay countable. Every route is declared in a per-model registry, and an
undeclared route fails the build.

*Client side:* one store is the source of truth. Records live in entity slices
keyed by id and nowhere else; membership and ordering live as id lists; the
request layer, the live feed and mutations are writers into that store rather
than places to look. Optimistic editing and stale-write rejection become one
implementation at the point a record is written.

*Both sides:* the invariants have mechanisms. A test fails if any part of the
store holds a second copy of a record's values. A test fails if the request
layer caches records. Typechecking fails if a record type is held outside the
entity slices. A test fails if the live route table disagrees with the declared
registry. Prose has already been tried twice.

## User Stories

The exhaustive lists are in the two child specs. The stories that only exist at
the seam between them:

1. As a frontend developer, I want exactly one canonical read per collection, so
   that "one query per collection" is achievable by construction rather than by
   discipline.
2. As a frontend developer, I want to read attachments without re-reading the
   work item, so that holding a record is sufficient to render it and no second
   copy is created to see its sub-collection.
3. As a frontend developer, I want server response shapes to match the model, so
   that no client-side re-shape is ever needed and the lossy summary type has no
   reason to be reinvented.
4. As a frontend developer, I want row-hiding flags to be my derivation over
   data I hold, so that a filter change cannot fragment the store.
5. As a maintainer, I want the server's ordering decisions expressed as ids the
   client stores, so that ordering is server-owned without records being
   duplicated to carry it.
6. As a maintainer, I want the same single-copy invariant enforced on both sides
   of the wire, so that neither side can reintroduce the class alone.
7. As a maintainer, I want the route registry and the store-uniqueness test to
   be readable together, so that "how many ways can this be read" and "how many
   copies exist" are both answerable in one sitting.
8. As an agent author, I want the MCP surface regenerated from the same contract
   the UI consumes, so that agents and the UI cannot disagree about a record.
9. As a maintainer, I want the workflow gate's structured rejection preserved
   end to end, so that the UI keeps telling users why a state move was refused.
10. As a maintainer, I want revision semantics unchanged across the wire, so that
    a single client-side stale-write rule can rely on them.
11. As a future maintainer on a different stack, I want the registry and its
    conformance test asserted against the route table rather than the framework,
    so that the convention survives a framework or language change.
12. As a reviewer, I want the deliberate contract breaks listed, so that I can
    tell them apart from regressions.

## Implementation Decisions

**Both halves ship the invariant, neither is sufficient alone.** The backend
stops manufacturing overlapping reads; the frontend stops mirroring and
re-shaping. Ordering: the API contract can land first, since the frontend
consumes whatever exists, but the frontend rebuild must not be reduced on the
grounds that the API is now well behaved — the mirroring and the lossy re-shape
are independent defects.

**Sequencing risk is accepted deliberately.** Implementation and tests are
rewritten together on both sides. On the backend the domain-service suite is the
automated net; on the frontend there is no equivalent net, and user-visible
behaviour is verified by hand. The alternative — writing the new suites first
against current code, so they stay green through the rewrite — was presented and
declined. It is recorded here because it is where regression risk lives.

**Tests that specify the defect are replaced, not preserved.** The existing HTTP
API tests assert that several endpoints return overlapping views of the same
rows; frontend tests construct fixtures of the lossy summary type. Neither can
serve as a conformance harness for a change whose purpose is to remove what they
assert. Domain-rule tests below the interface are the asset and carry over.

**Framework choices are accelerators, not guarantees.** DRF makes the
model-shaped default cheap; Redux Toolkit makes one inspectable store cheap.
Neither prevents the defect on its own — nothing in DRF forbids a bespoke view,
and nothing in Redux forbids a duplicate slice. The guarantees are the four
enforcement mechanisms above, which is why they are specified as deliverables
rather than as good practice.

**What is explicitly not changing:** models, migrations and domain services; the
async apps and their handlers; WebSocket consumers and the status-feed protocol;
terminal transport and tmux lifecycle; visual design.

## Testing Decisions

Both halves sort their suites the same way, and the sorting is a deliverable:

* **Domain-rule tests** — assert behaviour that holds whatever the interface
  looks like. These carry over and are what protects the change. On the backend
  they already exist below the HTTP layer; that is also the argument for keeping
  them there.
* **Shape tests** — assert the interface. On the backend these become
  parameterised over the route registry with responses validated against the
  generated schema, so the suite cannot encode overlap. On the frontend they
  collapse to one seam: mount real UI, mock HTTP, assert the DOM, with no
  reference to any store or cache.
* **Enforcement tests** — deliberately implementation-aware, because their job
  is to fail when an invariant breaks: store-wide record uniqueness, no records
  in the request layer's cache, no record types outside the entity slices, and
  no route absent from or extra to the registry.

The reported bug's regression test is the clearest statement of done: mount the
Stories pane and the details pane, rename through the DOM, assert the row's text
changes. It is library-agnostic and would pass against any correct
implementation.

## Out of Scope

* A per-section `(module, state)` list endpoint for pagination. Deferred; revisit
  with the pagination policy.
* GraphQL on either backend. Considered and rejected; recorded in an ADR so it is
  not re-proposed without new information. If it returns, it belongs on the Rust
  backend, where the schema can be derived from the entities.
* The Rust rewrite. Re-opened as an explicit question, not decided here.
* Moving the MCP surface off REST.

## Further Notes

**Why this is one problem.** The three layers are causally linked: the API offers
the same rows at four levels of hiding, so a request-keyed cache stores four
copies; the client then mirrors those into stores and re-shapes them lossily; and
no mechanism ever failed. Attack any one layer alone and the other two keep the
class alive. That is not a hypothesis — it is what happened twice.

**The Rust interaction.** `loco.rs` registers free-form handlers, has no
model-derived serializer analogue, and idiomatically hand-writes response
structs, so the planned rewrite as designed would regress the exact property the
backend half of this work buys. The registry and its conformance test are
specified to be portable for that reason, and the rewrite is re-opened as a
question to answer after living with a structured Django surface.

## Records

* Method used to reach these decisions: `docs/decision-making-method.md`
* Full reasoning, measurements and rejected alternatives:
  `docs/decisions/2026-08-04-frontend-state-and-api-contract.md`
* `studio/docs/adr/0009-redux-store-is-the-single-source-of-truth.md`
  (supersedes ADR-0006)
* `backend/worktracker/docs/adr/0005-model-shaped-crud-with-quarantined-rpc.md`
* `backend/worktracker/docs/adr/0006-graphql-considered-and-rejected.md`
* Glossary additions: `studio/CONTEXT.md` (Record copy, Membership) and
  `backend/worktracker/CONTEXT.md` (Route registry, Canonical collection read,
  Domain operation)