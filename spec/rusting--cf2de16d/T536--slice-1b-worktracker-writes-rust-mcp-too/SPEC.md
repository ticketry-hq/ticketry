# CODING-536 — Slice 1b: WorkTracker writes, Rust MCP, and the automation seam

Status: Spec complete
Story: CODING-536
Date: 2026-08-12

## Problem Statement

Ticketry currently has a split planning path: Studio and the WorkTracker agent
tools write through Django, while the Rust migration is preparing to make the
Tauri process the application core. Moving only Studio writes would leave the
Python FastMCP service writing the same WorkTracker tables through Django REST.
That would create two writers, two places for domain rules to drift, and no safe
cutover boundary.

The difficult behavior is not model-shaped CRUD. WorkTracker writes allocate
human sequence numbers, maintain a unified Module/Task hierarchy and denormalized
Module ancestry, assign fractional ranks, establish Manual module order, validate
workflow reachability and agent permissions, prevent blocker cycles, advance
revisions, and apply deletion/archive rules. Generated GraphQL mutators cannot
bypass those invariants.

State transitions also cross an ownership boundary. Today Django emits an
in-memory, post-commit signal and Django-owned execution may launch automation.
Once Rust owns the transition, that signal no longer exists. A notification-only
replacement could lose a launch during a crash, while retries without a durable
identity could launch the same transition twice.

This slice is therefore the migration's explicit go/no-go. It must prove that
Rust can become the sole writer for the WorkTracker capability, serve both Studio
and agents through stable contracts, preserve existing installations, and hand
transition occurrences to Django-owned execution without loss or duplication.

## Solution

Ticketry will adopt the existing WorkTracker schema in place and transfer the
entire checked WorkTracker write set from Django to restricted, model-shaped
Rust writes plus the five accepted domain operations in one release cutover.
GraphQL over TauRPC and the Rust MCP listener will be thin projections over the
same controller/model services. Seaography-generated CRUD is the baseline; a
raw entity mutator remains unavailable when it would expose protected fields or
bypass Ticketry invariants, and is replaced by one field-allowlisted
create/update/delete seam rather than operation-shaped RPCs.

The Rust MCP listener will run inside the Tauri application runtime and preserve
the current 30-tool registry, input schemas, output envelopes, and run-scoped
authorization behavior. WorkTracker reads and writes will call the Rust
application directly. Tools whose effects still belong to execution, runs, or
terminals may use a narrow authenticated compatibility port to the Django
sidecar, but that port may not write a Rust-owned WorkTracker table.

Every committed state identity change will insert an immutable transition
occurrence in the same database transaction as the WorkItem update. The
Django-owned execution consumer will durably materialize an Automation Attempt
under the occurrence identity before launching anything. Reconciliation and
idempotent launch ownership will ensure that retries adopt the existing attempt
or run instead of launching twice, and that an unprocessed occurrence remains
discoverable after either process restarts.

The handoff will run the ratified data-adoption sequence: classify without
mutation, stop all writers, checkpoint and verify a snapshot, apply only known
bridges and the Rust ledger, validate stable identities and semantic digests,
then publish readiness and enable writes. After the first Rust write, automatic
downgrade to Django is not supported.

The slice passes only when Studio mutations and agent task tools use Rust
end-to-end, the curated acceptance and recovery suites are green, and the build
survives a real daily-driver dogfood period. That evidence determines whether
the rest of the migration proceeds.

## User Stories

1. As a Ticketry user, I want my existing projects and work items to survive the Rust cutover unchanged, so that migration does not cost me planning history.
2. As a Ticketry user, I want work-item keys and human sequence numbers to remain stable, so that references in conversations, commits, and documents still resolve.
3. As a Ticketry user, I want a newly created work item to receive the same type-specific start state and append position as it does today, so that migration does not change where work enters a workflow.
4. As a Ticketry user, I want edits to names, descriptions, types, parents, blockers, and states to obey the same rules from every surface, so that Studio and agents cannot disagree.
5. As a Ticketry user, I want a rejected mutation to leave durable state unchanged and return an actionable error, so that optimistic UI can revert safely.
6. As a Ticketry user, I want task reordering to preserve fractional rank behavior, so that drag-and-drop remains stable without routine whole-list rewrites.
7. As a Ticketry user, I want the first Module drag to freeze exactly the visible automatic order and switch the Project to Manual order atomically, so that the persisted result matches what I moved.
8. As a Ticketry user, I want later Module drags to update only the moved Module's rank, so that Manual order stays efficient and predictable.
9. As a Ticketry user, I want reparenting to repair Module ancestry for the entire descendant subtree, so that navigation, scope, and execution continue to address the correct Module.
10. As a Ticketry user, I want invalid hierarchy changes to be refused without partial repair, so that my work tree cannot become cross-project, cyclic, or internally inconsistent.
11. As a Ticketry user, I want blocker updates to reject self-blocking and cycles, so that the dependency graph remains executable.
12. As a workflow administrator, I want transition, start-state, reachability, permission, and launch-policy changes to use revision compare-and-set, so that stale editors cannot overwrite newer workflow decisions.
13. As a workflow administrator, I want pruning a transition or state to report and apply the same dependent cleanup as Django, so that bindings and workflow warnings stay coherent.
14. As a human using Studio, I want legal human transitions to continue succeeding, so that the Rust port does not accidentally apply agent-only restrictions to me.
15. As an agent, I want status changes to identify me as agent-origin, so that the configured transition graph and agent permission control my move.
16. As an agent, I want current WorkTracker MCP tool names and argument schemas to remain stable, so that existing prompts and clients need no migration rewrite.
17. As an agent, I want current MCP result shapes and structured rejection envelopes to remain stable, so that I can interpret success and failure exactly as before.
18. As an agent, I want task identifiers to resolve by UUID or human key wherever they do today, so that existing tool calls remain portable.
19. As an agent, I want attachment creation to preserve metadata, authorized path handling, and content behavior, so that evidence can still be linked to work items safely.
20. As an agent, I want review-finding creation to remain inert except for its validated child WorkItem, so that it cannot unexpectedly launch work or move its Story.
21. As an agent, I want dependency and scope reads to reflect the Rust-authored state immediately after a write, so that follow-up decisions use one authority.
22. As an agent, I want my MCP bearer credential to authorize only the run and scope to which it was issued, so that another local process cannot control unrelated work.
23. As an agent, I want current-run termination to remain bound to the caller's authenticated run, so that the tool cannot become a general terminal kill surface.
24. As a user with workflow auto-start enabled, I want one committed transition to produce at most one launch, so that retries and restarts do not duplicate coding sessions.
25. As a user with workflow auto-start enabled, I want an eligible committed transition to remain launchable after a Rust or Django crash, so that automation is never silently lost at the boundary.
26. As a user, I want a rolled-back or rejected transition to produce no automation occurrence, so that failed writes have no external effect.
27. As a user, I want automation failure to be visible as a durable attempt rather than disguised as a successful transition callback, so that I can retry or diagnose it.
28. As a user, I want WorkTracker changes from Studio and MCP to converge in all open Studio surfaces, so that there is no stale second client holding.
29. As an operator, I want an unknown or corrupt schema to fail before any mutation, so that unsupported installations are not damaged.
30. As an operator, I want the pre-cutover snapshot to be WAL-consistent, hashed, reopenable, and discoverable, so that failure before Rust readiness is recoverable.
31. As an operator, I want interrupted adoption and interrupted transition delivery to resume deterministically, so that restart is a supported state rather than a manual emergency.
32. As an operator, I want the application to refuse partial readiness when GraphQL, MCP, database adoption, or the automation consumer is unhealthy, so that callers never reach a half-cut-over runtime.
33. As a maintainer, I want current Django behavior to win whenever donor Rust implementations differ, so that this slice is a port rather than a redesign.
34. As a maintainer, I want one checked ownership manifest for every table touched by WorkTracker commands, so that no Django route, signal, migration, seed, or agent adapter can remain as a hidden second writer.
35. As a maintainer, I want GraphQL and MCP to share authored commands and typed errors, so that invariant fixes are implemented once.
36. As a maintainer, I want each persisted model to have one restricted, model-shaped CRUD surface with an explicit writable-field allowlist, so that transports cannot bypass workflow, hierarchy, rank, revision, or effect rules and invariant helpers do not multiply the public mutation surface.
37. As a maintainer, I want contract generation and registry drift checks to fail CI, so that Studio and external agents cannot silently diverge from the implemented Rust surface.
38. As the migration owner, I want explicit acceptance and dogfood evidence for this slice, so that the decision to continue rewriting Ticketry is based on daily-driver reliability and operational simplicity.

## Implementation Decisions

* This is a behavior-preserving vertical port, not a domain redesign. Current
  Django service behavior and current public contracts are authoritative. The
  older Rust implementations contribute algorithms and fixtures only; any
  semantic disagreement is resolved in favor of current Django unless recorded
  as a separate, approved correction.
* The Tauri process owns one application runtime. The WorkTracker database
  connection, authored commands, GraphQL schema, durable dispatcher, and MCP
  listener are composed into that runtime. This slice must not introduce a new
  standalone Rust sidecar or a second application core.
* The Rust application is divided by concern: domain values and pure rules;
  model-shaped writes and queries; persistence/adoption helpers and migrations;
  GraphQL projection; MCP projection; transition occurrence dispatch; and
  startup/adoption composition. Files remain small and single-purpose. The
  existing native terminal renderer, tmux ownership, and fallback path are not
  folded into WorkTracker.
* A checked ownership manifest enumerates every database table and non-SQL
  asset that a WorkTracker command can mutate. All tables in that write closure
  transfer to Rust together at cutover. Django-owned execution, run, terminal,
  document, worktree, and settings tables remain with Django until their own
  slices. Cross-capability reads are allowed through narrow ports; a command may
  never cause both runtimes to write the same table.
* Before cutover, the shipping path has Django as the sole WorkTracker writer.
  Rust mutation code may run only against isolated fixtures or copied databases.
  There is no live shadow-write, dual-write, or compare-after-writing mode.
* Restricted Rust CRUD covers the complete persisted-model write set:
  workspace/onboarding facts used by planning; Project creation, update,
  deletion, and provisioning; issue-type and state catalogue changes; Module
  and Task creation, edit, archive/delete, attachments, parent and blocker
  relationships; workflow transition rows, start state, and launch bindings;
  and every associated revision advance or cleanup. Ordering,
  remove-state-from-workflow, and onboarding acknowledgement remain the five
  registry-declared domain operations. Internal model helpers own hierarchy,
  dependencies, transitions, pruning, revision allocation, and cascades without
  creating additional public mutation shapes.
* Human sequence allocation locks the Project counter and allocates once inside
  the creating command's transaction. Existing UUIDs and sequence numbers are
  never regenerated during adoption. A failed create consumes no visible
  partial WorkItem; whether its counter allocation rolls back follows current
  Django transaction semantics.
* WorkItem creation resolves the explicitly selected issue type before its
  birth state. A caller cannot use an explicit state to bypass the type's start
  state. Review-finding creation preserves its Story-in-Review, project, type,
  evidence, and inertness gates.
* A state transition remains its own internal model operation, reached through
  the WorkItem update contract. It cannot be bundled with unrelated field edits.
  The operation validates the type-scoped edge, caller origin, agent permission,
  landing rank, and cancelled-subtree behavior in one transaction. A no-op state
  assignment creates neither a revision advance nor a transition occurrence.
* WorkItem and Project revisions preserve the existing project-monotonic
  contract. Every externally visible WorkItem change advances the Project
  cursor and stores that value on the WorkItem exactly when Django does today.
  Workflow configuration mutations lock the issue type, compare the supplied
  workflow revision, apply the mutation, and advance the revision atomically.
* Fractional ranking preserves the current lexical key ordering, midpoint,
  boundary, invalid-neighbor, and rebalance semantics. Task neighbors must be
  valid under the same project/scope rules as today. Module reordering preserves
  the one-way Automatic-to-Manual transition: the first drag validates and
  ranks the complete visible baseline while holding the Project lock, then
  applies the requested move in the same transaction; later drags update the
  moved Module against current neighbors.
* Reparenting enters through `parent_id` on the restricted WorkItem update and
  runs in one transaction. Its internal helper validates the candidate
  relationship, updates the direct parent and derived Module, walks the full
  descendant tree, and repairs derived Module ancestry before commit. Legacy
  bulk adapters report reparented, skipped, and failed inputs in the established
  envelope without creating a second canonical mutation surface.
* Blocker replacement enters through `blocked_by_ids` on the restricted
  WorkItem update. Its internal helper validates normalized identifiers,
  same-domain endpoints, duplicates, self-edges, and graph cycles before
  replacing edges. Add/remove and reverse MCP compatibility tools invoke the
  same transactional helper rather than owning a second blocker mutation path.
* Delete/archive commands preserve current protected-state, non-empty-parent,
  cascading, and attachment behavior. Schema-level cascades are not treated as
  a substitute for command validation.
* Attachment metadata is committed only for an authorized, successfully
  materialized asset. Filename, MIME type, size, asset identity, and returned
  URL remain compatible. Failed filesystem or database work is reconciled or
  cleaned so neither an exposed orphan row nor a silently missing referenced
  file is reported as success.
* Domain failures use one typed Rust error vocabulary and preserve the current
  public meaning of not-found, validation, field validation, conflict, illegal
  transition, stale revision, unauthorized, and storage/unavailable failures.
  GraphQL error extensions and MCP structured envelopes project that vocabulary
  without leaking raw database errors or local paths.
* GraphQL exposes the already-adopted query model and one restricted
  create/update/delete surface per persisted model over TauRPC. Generated
  Seaography CRUD defines the default shape; any raw entity mutator that exposes
  protected fields or bypasses invariants stays private behind a documented,
  field-allowlisted model-shaped seam. The only non-CRUD public mutations are
  the five registry-declared domain operations. Mutation payloads contain enough
  authoritative entity and revision data for Studio to reconcile its canonical
  holding without racing a stale follow-up read.
* Each migrated Studio feature has one server-state authority. Its mutation
  call sites move from REST to generated GraphQL operations as a unit, while
  retaining the existing optimistic update, rollback, authoritative response,
  and membership invalidation behavior. The cutover does not leave parallel
  React Query and GraphQL entity holdings.
* The Rust MCP listener preserves the current registry of 30 tools: the 28
  generated WorkTracker tool methods plus `mcp_ping` and
  `terminate_current_run`. Tool names, descriptions where clients consume them,
  required/optional arguments, defaults, UUID-or-key resolution, nullability,
  and JSON result envelopes are contract inputs. Compatibility is measured from
  captured registry and scenario fixtures, not inferred from Rust types.
* MCP catalogue, workflow, WorkItem, hierarchy, blocker, and attachment tools
  call Rust application services directly. `mcp_ping` is listener-local.
  Execution graph launch, default-agent launch, and current-run termination may
  call a narrow Django-owned execution/run/terminal port while those capabilities
  remain Python-owned. Such calls carry stable idempotency and authorization
  context and are forbidden from mutating Rust-owned WorkTracker tables.
* The MCP listener binds only to loopback under Tauri lifecycle ownership. It
  starts after database adoption and application-service readiness, participates
  in application shutdown/restart, and is advertised to launched agents only
  after initialization and tool-list checks succeed. Listener failure is
  observable and cannot silently fall back to Python FastMCP for writes.
* MCP authorization is evaluated before tool dispatch. A bearer credential is
  resolved to its run identity and allowed WorkItem/Project scope through the
  current run authority. The resolved principal, not caller-supplied IDs alone,
  governs access. Credentials are never persisted in occurrences or logs.
  `terminate_current_run` uses only that principal's bound run and rejects a
  missing, invalid, expired, or unbound credential with the established
  envelope.
* Every committed state identity change receives a UUID occurrence identity
  minted inside the transition transaction. The append-only occurrence records
  a version, issue and project identity, issue type, from/to state identities and
  groups, WorkItem revision, workflow revision observed by the command,
  destination auto-start snapshot, and committed timestamp. Creation from no
  prior state may be recorded for feed parity, but is not automation-eligible.
* The transition occurrence and the WorkItem update commit atomically. A
  rollback writes neither. Realtime publication and process wakeups happen only
  after commit and are latency hints; the durable occurrence is the source of
  truth.
* Rust owns and appends the occurrence/outbox table. Django execution reads it
  but never acknowledges by mutating that Rust-owned row. Instead it upserts an
  Automation Attempt using the occurrence UUID as the unique source identity.
  Non-auto-start occurrences require no launch attempt; eligible occurrences
  become a durable Pending attempt before any launch effect.
* The execution consumer drains on startup, on a bounded periodic interval, and
  when Rust sends an after-commit wakeup. Claiming is concurrency-safe. A retry
  that sees the same occurrence adopts the existing attempt. A Pending or
  ambiguously started attempt is reconciled; it is never treated as consumed
  merely because a process began handling it.
* Launch ownership is idempotent on the Automation Attempt/occurrence identity.
  The durable run or launch ledger is checked and created before spawning the
  detached session; reconciliation adopts an already-created run. Success and
  failure update the attempt and existing status projection. This closes both
  boundary failure modes: no committed eligible occurrence disappears, and no
  occurrence owns more than one launch.
* The transition snapshot preserves current behavior: eligibility is frozen
  from the destination's auto-start setting and observed workflow revision at
  transition time; Django-owned execution resolves the launch configuration at
  consumption through its existing authority until launch policy migrates.
  Later launch-policy migration may change that rule only through a new spec.
* Rust also emits durable WorkItem and workflow-catalog change facts needed by
  current Studio and status projections. Project revisions remain the compact
  repair cursor. Live subscribers receive committed facts only; reconnect uses
  an authoritative snapshot plus bounded replay, and lag requires resnapshot.
* Adoption follows a strict startup state machine: acquire the installation
  lease; stop Django WorkTracker writes; checkpoint SQLite WAL; classify the
  exact schema without mutation; run integrity and semantic preflight; create
  and verify a rotating snapshot; apply only named bridges and the Rust
  migration ledger transactionally; validate row counts, stable-field digests,
  foreign keys, and golden reads; start occurrence reconciliation; then publish
  GraphQL/MCP readiness and accept Rust mutations.
* Unknown schema generations, failed integrity checks, invalid relationships,
  unsafe paths, migration-ledger drift, digest mismatch, or a failed readiness
  component stop startup before writes. Preflight reports actionable counts and
  identifiers without repairing unknown defects implicitly.
* SQLite is the required desktop cutover target for this slice. An existing
  PostgreSQL installation must either pass a separately implemented,
  acceptance-tested import into the canonical SQLite schema or be refused with
  an explicit compatibility message. Merely opening both engines through an ORM
  is not acceptance evidence.
* Before Rust readiness, recovery may restore the verified snapshot. Once a
  Rust mutation has committed, Ticketry must not automatically reopen the
  installation with Django or restore the old snapshot, because that would lose
  new facts. The UI and recovery guidance mark this no-automatic-return point.
* Readiness is one versioned application result covering database ownership,
  GraphQL, MCP, and transition-consumer health. A partial service is not
  advertised as ready. Shutdown stops accepting commands, drains or safely
  leaves durable work for restart, and releases the installation lease.
* The migration proceeds beyond Slice 1b only after all automated gates pass
  and a copied-data then ordinary-data daily-driver dogfood run demonstrates
  reliable create/edit/reorder/reparent/transition/attachment flows, real agent
  MCP usage, automation across restart, and usable recovery evidence. Failure
  to achieve reliability or a simpler operational model is a no-go result, not
  permission to run both writers.

## Testing Decisions

* Good tests assert behavior at the highest stable seam: command inputs and
  committed state, GraphQL operations visible to Studio, MCP list/call
  contracts, durable occurrence-to-attempt outcomes, startup/adoption results,
  and user-visible Studio behavior. Tests do not assert private helper calls,
  ORM implementation details, component-local state, or generated-code layout.
* The primary domain seam is the authored application command against an
  isolated database. Port the current Django service cases for sequence
  allocation, start-state resolution, mixed-transition rejection, human versus
  agent permissions, cancelled-subtree landing, revision advances, workflow
  compare-and-set, transition pruning, hierarchy repair, blocker cycles,
  fractional ranks, first and later Module drags, protected deletion, review
  findings, and attachments.
* Use the historical database and parity corpus as fixture inputs, but run the
  actual current Django command and the actual Rust command against separate
  cloned stores. Compare normalized public results, rows, relationships,
  revisions, occurrences, and externally visible effects. This is targeted
  characterization for the WorkTracker write set, not a production dual-write
  path or a universal second parity framework.
* Add concurrency tests for Project sequence allocation, first-Module-drag
  serialization, simultaneous workflow revision changes, blocker updates, and
  competing reparent/transition operations. Assert one valid committed result,
  deterministic conflict responses, and no partial ancestry or rank repair.
* Test GraphQL through the TauRPC transport with the real composed application
  state. Assert the mutation registry exactly matches the restricted model CRUD
  surface plus the five declared domain operations, protected fields are absent,
  typed error extensions survive Rust-to-GraphQL-to-TypeScript, and mutation
  responses carry the authoritative entity/revision required by the client.
* Update every affected numbered Studio acceptance case to use the desktop
  GraphQL runtime seam. Add cases for create, edit, type/parent/blocker changes,
  legal and rejected transitions, task reorder, first and later Module reorder,
  deletion/archive, attachment refresh, optimistic rollback, authoritative
  convergence, and a second client receiving committed changes. Keep the
  overhaul gate count current and run the mandated overhaul suite.
* Snapshot the existing FastMCP registry before removal and assert exact parity
  for all 30 Rust MCP tools: tool names, JSON input schemas, optional defaults,
  descriptions where material, success values, null behavior, and structured
  error envelopes. Run representative tools through the real listener rather
  than only calling Rust handlers directly.
* MCP authorization tests cover missing, malformed, expired, foreign-run, and
  out-of-scope credentials; legitimate UUID and key addressing; forwarded
  execution calls; and current-run termination. Assert unauthorized calls make
  no domain or execution write and secrets never appear in logs.
* Automation seam tests use a crash/retry matrix at each boundary: before the
  WorkItem transaction commits; after commit before wakeup; before and after
  Automation Attempt creation; before launch-ledger creation; after ledger
  creation before spawn; after spawn before success recording; while Rust is
  down; and while Django execution is down. Each committed eligible occurrence
  eventually owns one durable attempt and no more than one run; rejected and
  rolled-back transitions own none.
* Realtime tests cover register/snapshot/replay/live ordering, project revision
  repair, duplicate occurrence delivery, subscriber lag and resnapshot, and
  restart with undrained durable facts. In-memory notification loss must not
  affect eventual correctness.
* Adoption tests cover every supported current and historical SQLite schema,
  empty provisioning, already-Rust-owned reopen, unknown-schema refusal,
  foreign-key and integrity failure, known bridge idempotency, WAL-safe snapshot
  verification, crash before and after ledger commit, stable UUID/sequence/rank/
  revision digests, attachment roots, and restart after adoption.
* PostgreSQL is covered by an end-to-end consistent import and digest suite if
  the product retains import support. Otherwise startup tests assert a clear,
  non-mutating unsupported-path refusal.
* Run focused Rust unit/integration tests, GraphQL schema and binding drift
  checks, TypeScript typecheck, the full Studio test suite, the numbered
  overhaul acceptance gate, MCP transport/contract tests, packaged restart
  tests, and existing Django execution/run tests affected by the new consumer.
* Dogfood begins against a verified copy of the real data directory. After that
  passes, use the Rust-owned build as the daily driver for at least two working
  days. Exercise real projects, Manual module order, hierarchy changes,
  workflow editing, agent MCP transitions, auto-start, attachments, application
  restart, agent completion, and recovery inspection. Record failures and
  operational friction as go/no-go evidence.

## Out of Scope

* Creating, splitting, editing, or wiring Implementation tickets during this
  Spec stage.
* Redesigning WorkTracker terminology, schema shape, workflow semantics,
  hierarchy rules, ranking rules, public error meaning, or MCP ergonomics.
* Exposing unrestricted generated model mutators, per-field/per-relationship
  RPCs, or allowing native, GraphQL, MCP, or compatibility adapters to write
  tables directly outside the restricted model/controller surface.
* Production dual-write, shadow-write, or using a live user's database for
  differential tests.
* A post-write automatic downgrade to Django or a Rust-to-Django reverse
  converter.
* Porting the execution scheduler, Agent Run lifecycle, terminal ownership,
  tmux runtime, documents, worktrees, profiles, provider catalogue, or general
  settings capability to Rust beyond the narrow ports required by WorkTracker.
* Removing the Django sidecar, Python packaging, generated OpenAPI SDKs, or
  browser-supporting services before their remaining consumers migrate.
* Rewriting the native libghostty renderer, tmux durability model, or existing
  terminal fallback.
* GraphQL-native schema redesign, nested-query optimization, subscription UI
  redesign, or replacing the established Studio cache discipline.
* A general event-platform rewrite beyond the durable WorkTracker facts and
  Django execution inbox behavior required to cross this ownership boundary.
* Guaranteeing independent external network exposure; the MCP listener remains
  a narrowly authenticated loopback projection owned by the desktop runtime.
* Proceeding to later migration slices merely because code landed; the go/no-go
  decision requires the stated acceptance and dogfood evidence.

## Further Notes

* The governing reference is the ratified Slice 1b in
  `rust-migration/migration-strategy.md`, together with the adoption and rollback
  rules in `rust-migration/data-migration.md`.
* The current Django WorkTracker services and public Studio/MCP behavior are the
  semantic oracle. The `worktracker-rust` domain modules and the historical
  `Rusty/ticketry-rust` database/parity artifacts are donors, not authorities.
* The essential architecture is one writer and one command implementation per
  invariant, with GraphQL and MCP as projections. If implementation pressure
  suggests retaining a hidden Django write route, the correct result is to stop
  the cutover and report a no-go, not weaken that boundary.
* Existing child tickets under CODING-536 predate this Spec run. This workflow
  creates no additional implementation work items and does not treat those
  children as a substitute for this binding parent specification.
