# Spec — WorkTracker API: model-shaped CRUD, fixed read contract, declared routes

Child of CODING-142 (see `../T142--update-task-name-in-the-task-list-when-i/spec.md`).
This file mirrors the Story description on CODING-144 — the tracker copy and
this copy are the same document; update both together. `lld.md` in this
directory carries the file-level design for implementing agents.
`grill-handoff.md` is the audit trail of the interview.

## Problem Statement

Nobody can answer the question "how many ways can this model be read or
written?" No artefact lists the reads and writes per model. The answer is only
discoverable by reading 44 hand-authored endpoint functions.

Because every endpoint is a free-form choice, the same model is described by
seven hand-written schemas, and the surface drifted in ways nobody decided:

* Four work-item list reads return nested subsets of the same rows. A client
  that caches by request shape holds the same row several times. This caused
  the Studio bug where a renamed Story kept its old name in the list.
* Attachments have a write route and no read route.
* No read paginates, and two reads return rows in unspecified database order.
* Launch configurations validate their provider, model, and reasoning values
  against a hardcoded code registry. Adding a model requires a code change and
  a sidecar rebuild. Users cannot add models themselves.
* The quarantine idea existed, but several honestly-CRUD operations sat inside
  it, and several composite reads duplicated rows that model reads also serve.

## Solution

The CRUD half of the surface becomes model-shaped by construction: views bound
to models, serializers derived from models. One model has one serialized shape.

The exceptional half shrinks to five named domain operations, each with a
recorded reason it cannot be CRUD.

The provider, model, and reasoning-level vocabulary moves from code into three
database tables. Launch configurations point at those rows with foreign keys.
Users add models as rows.

The read contract is fixed: one collection read per model, narrowing by
declared filter parameters, sub-collections read through their own routes, and
a stated no-pagination policy with explicit ordering. The client-side safety
rule is a normalized row store: a record exists in exactly one place, and every
response merges into it by id.

A per-model route registry becomes the artefact that answers the opening
question. A conformance test walks the full live route table and fails on any
two-way mismatch.

## User Stories

1. As a backend maintainer, I want one declaration listing every read and write per model, so that I can see the whole surface without reading every handler.
2. As a backend maintainer, I want an undeclared route to fail the build, so that the surface cannot grow by accident.
3. As a backend maintainer, I want the conformance test to walk the full route table, so that no app's routes are invisible to it.
4. As a backend maintainer, I want serializers derived from models, so that a model change cannot silently leave one representation behind.
5. As a backend maintainer, I want one serialized shape per model, so that consumers stop discovering variants of the same record.
6. As a backend maintainer, I want the five domain operations gathered in one named module, so that I can count the exceptions at a glance.
7. As a backend maintainer, I want the registry to record why each domain operation is exceptional, so that a future reader does not "tidy" a deliberate one into CRUD.
8. As a backend maintainer, I want a stated rule for computed read fields, so that a reviewer can refuse a field that reaches outside the model.
9. As a frontend developer, I want one work-item list route with declared filter parameters, so that the module subtree stops being a second overlapping read.
10. As a frontend developer, I want every response to merge into one normalized row store by id, so that a record cannot exist under two cache keys.
11. As a frontend developer, I want to read a work item's attachments through their own route, so that holding a record is sufficient to render it.
12. As a frontend developer, I want response shapes that match the model exactly, with related objects as bare ids, so that I never re-shape a server record.
13. As a user, I want to add a model row for a new model name myself, so that a new model release does not require a code change.
14. As a user, I want the launch pickers to offer only activated providers, their model rows, and each model's permitted reasoning levels, so that I cannot configure an invalid launch.
15. As a user, I want deletion of a catalog row that a launch configuration uses to be refused, so that my configurations cannot dangle.
16. As a user, I want a state delete to be refused while work items sit in that state, so that no ticket is moved without my action.
17. As a user, I want starting a dependency subtree run to be a create on the run resource, with a conflict when a run is already armed, so that duplicate runs are impossible.
18. As an agent author using MCP, I want the tool surface regenerated from the same contract the UI uses, so that agents and the UI cannot disagree about a record's shape.
19. As an SDK consumer, I want the generated client to expose one obvious read per collection, so that picking a wrong variant is not possible.
20. As a maintainer, I want the pagination policy stated as deliberately unpaginated with explicit ordering on every read, so that absence of pagination is a decision, not an accident.
21. As a maintainer, I want the workflow transition rules, rank allocation, sequence allocation, blockers, and archiving untouched, so that risk stays at the interface — except the two deliberate service changes this spec names.
22. As a maintainer, I want the async apps and WebSocket consumers left on their current stack, so that streaming and subprocess handling keep their async model.
23. As a maintainer, I want the workflow gate's structured rejection preserved exactly, so that the UI keeps explaining why a state move was refused.
24. As a maintainer, I want authentication applied uniformly across the new views and asserted by a test, so that the framework change opens no unauthenticated surface.
25. As a maintainer, I want a work item's change-revision semantics unchanged, so that ordering guarantees for concurrent writers hold.
26. As a reviewer, I want the intentional contract breaks listed, so that I can tell them from accidental regressions.
27. As a future maintainer on a different stack, I want the registry and its conformance test asserted against the route table, so that the convention survives a framework change.

## Implementation Decisions

**Framework split.** Django REST Framework serves every worktracker operation:
the model CRUD as model-bound viewsets, and the five domain operations as plain
APIViews in one quarantine module — never as actions on the viewsets. The ninja
worktracker router and its standalone OpenAPI builder are deleted;
`openapi.json` comes from one generator (drf-spectacular). The async apps
(terminals, documents, runs, worktrees, execution) stay on ninja. Channels
consumers are untouched.

**The provider/model/reasoning catalog (new tables).** Three tables: Provider
(slug, activated, supports\_unattended), Model (foreign key to Provider),
Reasoning level (linked to models through a link table). A startup guard checks
Provider slugs against the code-owned adapter set — rows describe providers;
adapters implement them. Provider activation moves from the settings JSON into
the Provider row. A launch configuration references the catalog by foreign
keys: its model column points at a Model row (the provider is implied, so the
agent column is removed), its reasoning column points at a Reasoning level row
validated against the model's permitted links. Delete protection refuses
removal of a row in use. The free-text model path is removed; the launch triple
picker gains an add-model action that creates the row. The global launch
default is validated against the tables at write time. A migration seeds the
tables from the current code registry and maps existing text values onto rows.

**The quarantine — five domain operations.** Work-item reorder (the server
computes the rank value; sole rank write path). States reorder and issue-types
reorder (multi-row atomic total ordering). Remove-state-from-workflow (no row
records workflow membership; the operation edits the whole edge set, then
performs the workflow prune). Onboarding acknowledge (a one-way write; no
inverse route exists). The registry records each reason.

**Reclassified into CRUD.** Workspace read; launch-binding collection read; the
launch-binding upsert/delete by its composite (issue type, state) key; the
auto-start and subtree-run flag writes, folded into the launch-binding update
with the "no automation without launch configuration" guard as serializer
validation. Transitions become a CRUD resource: create, permission update, and
delete; the delete performs the workflow prune. Start-state moves into the
issue-type update, with the same prune on disconnection. The workflow-revision
concurrency guard rides in the write bodies.

**Deleted routes.** The review-finding create folds into the work-item create:
the same pre-write gate, returning the identical structured 422. The
workflow-settings composite read is decomposed into the model reads it
duplicated; standing warnings become a client derivation. Both impact previews
and the impact token are removed. The subtree-run-capabilities read is removed;
the client derives it from launch-binding rows. The provider-capabilities read
is replaced by the catalog table reads. The scope-context read is removed; the
MCP tool assembles the same picture from CRUD reads and composes the advisory
sentence itself — the tracker stops composing prompt text. The module work-item
list is removed.

**State delete (deliberate service change).** `DELETE` on a state is refused
while any work item sits in that state, and refused for protected and
last-in-group states. The reassignment machinery and the impact-token handshake
are removed from the service. Bulk operations, the future answer for emptying a
stuck state, go to the backlog.

**Graph runs (deliberate reshape).** The run header becomes a CRUD resource at
a work-item-scoped singleton route: create arms the run, read returns it,
delete resets it. Handlers stay async on ninja. The create keeps its guards:
conflict when a run is already armed for the root, refusal when the type/state
cell lacks the subtree-run capability. The registry declares these routes as
model CRUD.

**Read contract.** One collection read per model. The work-item list takes
declared filter parameters (project, module, state) and keeps the archived and
pathfind server-side hiding parameters. The safety invariant is client-side:
one normalized row store, merged by id. Attachments are read at a nested
sub-collection route under the work item; the single-work-item read stops
bundling them, so reading one work item returns a bare work item. Related
objects serialize as bare ids — both state and issue type. All reads are
declared unpaginated by decision, and every read has an explicit ordering.

**Computed read fields.** Allowed under three conditions: derived only from the
model row and its own relations; read-only; declared on the serializer. The
four current work-item fields (key, sub-issues count, blocked-by ids, blocks
ids) pass. The rule goes in the ADR.

**Route registry.** One declaration keyed by model, listing each read and write
with verb, path, and purpose. The conformance test resolves the full live route
table and asserts a two-way match in three tiers: worktracker models and the
graph-run routes as per-model declarations; the remaining async app routes as a
flat one-line-per-route allowlist; a short declared exclusion list for
framework prefixes. It asserts against the route table, not the framework.

**Auth and errors.** The x-api-key check becomes a default-applied DRF
authentication class; the disable-auth escape hatch is kept. A conformance test
asserts every declared route requires the key. The service-error mapping
becomes one DRF exception handler. The transition gate's structured 422 body
(detail, code, from, to) is preserved byte-for-byte and pinned by a test.

**Ubiquitous language updates.** The CONTEXT.md entries for Model
configuration, Launch triple picker, and Activated provider are rewritten: the
Settings surface now stores model rows and reasoning-level links, and
activation lives on the Provider row. The Route registry, Canonical collection
read, and Domain operation entries are amended to match the filter decision.
The nested-object defence in the work-item schema docstring is deleted.

**Regeneration and landing.** The TypeScript SDK, the Python SDK, and the MCP
surface regenerate from the one contract in the same change. MCP tools keep
their argument shapes; their internals update mechanically where deleted routes
force it. The backend lands on its own branch with the regenerated SDKs and a
green domain suite; the Redux frontend rebuild stacks on that branch; main
receives them together as one release.

## Testing Decisions

A good test asserts externally observable behaviour — HTTP status, response
body, persisted state — and never reaches into view or serializer internals.

**Three seams.** One new seam: the HTTP boundary, parameterized over the route
registry. For every declared read, the response validates against the schema
generated from the serializers. For every declared write, invalid input is
rejected and valid input persists. No undeclared route resolves; every route
requires the API key; the gate's 422 body is pinned. New behaviour tests sit at
this same seam: state delete refused when occupied, transition delete prunes,
graph-run create conflicts on a live run, catalog foreign-key delete
protection, one-way acknowledge. Two existing seams: the service-level
domain-rule suite carries over untouched (workflow gating, rank allocation and
reorder races, sequence allocation, blocker cycles, archiving cascade, workflow
configuration), and the two packaged-sidecar HTTP tests must stay green with
DRF in the frozen build.

**Shape tests are re-authored, not preserved.** The existing HTTP tests specify
the overlap defect; the registry-parameterized suite replaces them and cannot
encode overlap. The five quarantined operations keep hand-written tests.

## Out of Scope

* Bulk operations (including bulk state reassignment) — backlogged; they are
  the future answer for emptying an occupied state.
* MCP surface redesign — tools keep their shapes; only mechanical internal
  updates.
* Any domain-service change beyond the two named: the state-delete
  simplification and the graph-run route reshape.
* The async apps' handler logic, WebSocket consumers, and the status-feed
  protocol.
* Pagination — revisit with the deferred per-section list read if a size
  problem appears.
* GraphQL (rejected in the recorded ADR) and the Rust rewrite (re-opened as a
  question, not decided here).

## Further Notes

The final route arithmetic: the quarantine shrank from 21 operations to 5.
Seven routes are deleted outright, their needs served by canonical reads plus
client derivation. The catalog tables convert a code registry into
user-editable data — the first time the surface's vocabulary is extensible
without a sidecar rebuild.

The registry-plus-test remains the portable guarantee; DRF is only the
accelerator. The workflow-impact and scope-context deletions both follow one
principle: a server computation whose only consumer can derive or compose it
locally is not a read — it is coupling.

Records: the model-shaped-CRUD ADR (0005), the GraphQL rejection ADR (0006),
the frontend state and API contract decision record, and `lld.md` in this
directory.

*Triage: ready-for-agent*