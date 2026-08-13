# CODING-538 — Slice 3: Durable events, runs, and status streaming

Status: Spec complete
Story: CODING-538
Date: 2026-08-12

## Problem Statement

Ticketry's current run and status behavior is split across durable Django rows,
post-commit signals, an in-memory Channels bus, a receive-only WebSocket, and
the Python terminal launcher. The status connection presents an authoritative
snapshot and can replay some WorkItem changes from a retained revision, but most
live frames are notifications only. A backend crash can therefore lose the
notification that tells Studio about a lifecycle change, and a reconnect cannot
replay every event family from one ordered history.

Automated launches cross an even more important durability boundary. A
committed WorkItem transition is materialized as an Automation Attempt, and the
terminal launcher accepts a caller-supplied Agent Run identity, but the external
launch effect is not yet represented by a complete durable state machine. A
crash between recording an attempt, creating a terminal runtime, and recording
the result can leave the system unable to distinguish "not launched" from
"launched but not acknowledged." Blind retry risks starting the same work
twice; treating an ambiguous attempt as consumed risks losing it.

The Rust migration also cannot leave Python writing Agent Run or Automation
Attempt tables after Rust adopts them. The still-Python terminal and execution
capabilities need a narrow compatibility boundary that asks Rust to prepare and
record lifecycle facts without becoming a second writer. Studio, meanwhile,
must move from `/ws/status` to the in-process GraphQL transport without losing
project scoping, authoritative reconciliation, reconnect behavior, or the race
protection already built into the feed.

The user-visible requirement is simple: lifecycle facts must survive a crash or
restart, status must converge after disconnection, and the same durable fact
must never launch two coding sessions.

## Solution

Ticketry will port the Runs capability into the existing Tauri application core
and make Rust the sole writer for Agent Runs, Automation Attempts, the status
event outbox, and durable launch-effect records. The port preserves the current
domain meanings, query scopes, retry lineage, lifecycle reduction, and terminal
outcomes. It is a behavior-preserving migration slice, not a redesign of agent
execution or terminal ownership.

Every status-relevant run or attempt mutation will commit an immutable,
project-scoped outbox event in the same transaction as its authoritative row.
The outbox assigns one global, monotonically increasing 64-bit cursor. Realtime
notifications carry only a wake-up; subscribers always read ordered events from
the database. WorkTracker events already produced by the Rust core join the
same ordered projection. Capabilities that remain Python-owned keep their own
authoritative data and use an explicit compatibility adapter; reconnects
refresh their canonical query holdings rather than treating an in-memory frame
as history.

Studio will consume a generated GraphQL subscription over TauRPC. On each
connection the server registers the live listener first, captures an
authoritative snapshot and high-water cursor, replays durable events after the
client's retained cursor through that high-water mark, and then releases
buffered newer events in cursor order. If compaction has passed the retained
cursor, the subscription emits an explicit reset requirement and Studio
refetches the canonical project holdings before applying buffered events. The
old status WebSocket is removed after the subscription path passes the migration
gate.

Launch callers will mint the Agent Run and launch-effect identities before any
terminal side effect. Rust atomically persists the Agent Run, immutable launch
intent, and prepared Launch Effect. The Python terminal capability temporarily
acts only as the effect executor: it claims the durable effect, uses the
predetermined Agent Run identity, and reports a typed outcome back to Rust.
Startup reconciliation inspects the deterministic terminal identity before
retrying an ambiguous effect, adopting an existing runtime when present. One
Automation Attempt owns at most one Launch Effect and one Agent Run; an explicit
retry creates a new retry attempt and a new predetermined pair.

The slice is complete when Rust owns these tables and commands, authoritative
status queries and the GraphQL subscription are in production Studio, crash and
duplicate-delivery scenarios converge correctly, `/ws/status` is no longer a
shipping dependency, and no Python path can directly mutate a Rust-owned Runs
table.

## User Stories

1. As a Ticketry user, I want an active agent's status to return after an application restart, so that a crash does not erase what the agent was doing.
2. As a Ticketry user, I want completed, failed, lost, and terminated runs to remain authoritative after reconnect, so that stale live indicators do not survive a restart.
3. As a Ticketry user, I want a newly launched run to appear immediately and remain visible if I reload, so that live feedback and durable truth agree.
4. As a Ticketry user, I want a run created while a status snapshot is being assembled to remain live, so that snapshot timing cannot falsely mark it exited.
5. As a Ticketry user, I want lifecycle events delivered out of order to preserve the newest known state, so that a delayed hook cannot regress a run.
6. As a Ticketry user, I want terminal completion to override an older working or waiting lifecycle state, so that a dead session is never presented as active.
7. As a Ticketry user, I want provider session identity to survive restart, so that supported provider conversations can still be resumed.
8. As a Ticketry user, I want project and task status queries to return only their authoritative scope, so that one project's activity cannot leak into another.
9. As a Ticketry user, I want old ended runs to follow the current visibility horizon while old active runs remain visible, so that snapshots stay useful without hiding live work.
10. As a Ticketry user, I want a committed WorkItem change from another client to refresh the affected item, so that Studio converges without a manual reload.
11. As a Ticketry user, I want hierarchy or membership changes to refresh the containing collection, so that moved, created, archived, and deleted items appear in the right place.
12. As a workflow administrator, I want workflow-state edits and ordering changes to reach every open Studio window, so that names, colors, groups, and order stay consistent.
13. As a Ticketry user, I want unresolved automation failures to survive reconnect and remain retryable when appropriate, so that launch problems are visible and actionable.
14. As a Ticketry user, I want dismissed historical automation failures to stay dismissed, so that migration does not resurrect obsolete warnings.
15. As a Ticketry user, I want retrying one failed Automation Attempt twice to return the same retry attempt, so that double-clicks and request retries do not create duplicate work.
16. As a Ticketry user, I want a successful automated transition to start at most one coding session, so that duplicate occurrence delivery cannot launch twice.
17. As a Ticketry user, I want an eligible transition committed just before a crash to launch after restart, so that automation is not silently lost.
18. As a Ticketry user, I want a launch that happened just before a crash to be adopted rather than repeated, so that ambiguous acknowledgement does not duplicate a terminal.
19. As a Ticketry user, I want a failed launch to retain a durable reason and retryability decision, so that failure is not confused with an unprocessed request.
20. As a Ticketry user, I want an explicit retry to have its own Agent Run identity and history, so that the original failure remains auditable.
21. As a Ticketry user, I want a rolled-back transition or launch preparation to create no terminal effect, so that failed transactions cannot leak external work.
22. As a Ticketry user, I want manual launches to remain intentionally repeatable, so that starting a second session is possible while transport retries remain idempotent.
23. As an agent, I want lifecycle hook delivery to be acknowledged only after durable application, so that a successful response means the fact survived the process boundary.
24. As an agent, I want duplicate lifecycle hook facts to be harmless, so that spool replay or HTTP retry cannot corrupt run state.
25. As an agent, I want an unknown historical Agent Run identity to retain the current accepted/no-op compatibility behavior, so that late hooks do not destabilize the provider.
26. As an agent, I want current-run termination to remain bound to my authenticated Agent Run, so that I cannot terminate another run by supplying its identifier.
27. As an agent, I want termination outcome to become durable status, so that the next snapshot cannot repaint a terminated run as active.
28. As a Studio user, I want status to reconnect automatically after network loss, wake, or visibility restoration, so that transient disconnects heal without intervention.
29. As a Studio user, I want reconnect to continue from the last accepted cursor, so that I do not miss changes made while disconnected.
30. As a Studio user, I want a stale or compacted cursor to trigger a safe authoritative refresh, so that a long absence cannot leave silently stale data.
31. As a Studio user, I want project switching to prevent queued frames from the old project changing the new project view, so that asynchronous teardown cannot cross scopes.
32. As a Studio user, I want malformed, unsupported, duplicate, or backwards cursor frames to be ignored safely, so that one bad event cannot corrupt the local holding.
33. As a Studio user, I want status updates to coexist with an in-flight optimistic edit, so that a replay cannot paint an older value over my current mutation.
34. As a Studio user, I want run, attempt, workflow, WorkItem, terminal-outcome, and document-availability behavior to remain unchanged when the transport moves to GraphQL, so that the migration does not remove visible capabilities.
35. As an operator, I want every durable status event to have a monotonic cursor and project identity, so that ordering and scope can be diagnosed from persisted facts.
36. As an operator, I want realtime publication failure to leave committed lifecycle truth intact, so that an unavailable channel delays delivery rather than rolling back state.
37. As an operator, I want outbox compaction to publish a durable project watermark, so that the server can distinguish an empty replay from an unrecoverable cursor gap.
38. As an operator, I want a bounded replay batch and explicit reset response, so that a severely lagged client cannot exhaust memory or monopolize the database.
39. As an operator, I want startup reconciliation to drain prepared and ambiguously claimed launch effects, so that restart is a supported operating state.
40. As an operator, I want unknown or incompatible Runs schemas to fail before mutation, so that adoption cannot damage an existing installation.
41. As an operator, I want existing Agent Run and Automation Attempt identities, timestamps, status, retry lineage, and provider session IDs preserved, so that migration does not rewrite history.
42. As a maintainer, I want Rust to be the only writer for each adopted Runs table, so that Python and Rust cannot disagree about lifecycle truth.
43. As a maintainer, I want GraphQL queries, GraphQL subscriptions, MCP operations, and terminal compatibility calls to share the same Runs services, so that invariants live in one implementation.
44. As a maintainer, I want event payloads versioned independently of in-memory Rust types, so that retained events remain readable across upgrades.
45. As a maintainer, I want the outbox to store domain facts rather than frontend cache instructions, so that projections can evolve without rewriting history.
46. As a maintainer, I want launch intent to exclude credentials and computed shell commands, so that durable reconciliation does not persist secrets or create a command-execution backdoor.
47. As a maintainer, I want generated GraphQL operation and TypeScript types to drift-check in CI, so that Studio cannot silently diverge from the subscription schema.
48. As the migration owner, I want curated crash, replay, duplicate, and daily-driver evidence for this slice, so that later capability migrations build on a proven lifecycle core.

## Implementation Decisions

* This slice ports the current Runs capability into the managed Tauri
  application core. It does not introduce a standalone Rust service. The
  existing GraphQL endpoint, TauRPC transport, database lifecycle, structured
  errors, and deterministic generation chain are extended rather than
  duplicated.
* Current Django behavior is the semantic authority. Existing status values,
  lifecycle reduction, timestamp ordering, project/task scope, ended-run
  visibility, retry lineage, dismissal, provider-session behavior, and public
  error meaning are preserved unless this specification explicitly strengthens
  a crash boundary.
* Rust adopts the existing Agent Run and Automation Attempt tables in place and
  adds focused tables for Status Events, project compaction watermarks, and
  Launch Effects. Stable IDs and historical rows are preserved. Known schema
  bridges are explicit; an unknown schema or invalid invariant fails adoption
  before the write lease changes hands.
* The ownership manifest is updated atomically at cutover. Rust is the sole
  production writer for adopted Runs tables and the new outbox/effect tables.
  Python terminal and execution code may call authored Rust commands but may
  not retain ORM, raw SQL, migration, admin, signal, or test-helper write paths
  to those tables.
* The Runs capability is separated by concern: run lifecycle commands and
  queries; automation-attempt commands and projections; outbox append/replay
  and compaction; launch-effect preparation, claim, outcome, and reconciliation;
  GraphQL query/subscription projection; and compatibility adapters for
  capabilities not yet migrated. Large transport or composition modules are
  not extended with domain logic.
* Agent Run creation, lifecycle change, provider-session capture, terminal
  outcome, explicit termination, and Automation Attempt changes are authored
  commands. GraphQL, MCP, lifecycle ingress, and the terminal executor call the
  same commands and receive the same typed errors.
* Agent Run identity is minted before launch. A caller may provide a
  predetermined identity only through an idempotent launch request. An existing
  identity is adopted only when target, scope, provider, and effect identity
  match; otherwise the command returns a conflict. A normal interactive launch
  mints a new request and remains intentionally repeatable.
* An Agent Run is persisted before its external terminal effect and begins in
  the established starting/prepared meaning. Lifecycle state and its timestamp
  remain separate from terminal status. An ended timestamp or explicit terminal
  outcome is terminal authority and cannot be regressed by a late provider
  hook.
* Lifecycle updates compare normalized UTC timestamps inside the write
  transaction. Older events and exact duplicates are no-ops. Provider session
  identity preserves the current first-valid-value behavior. Unknown run facts
  keep the current accepted/no-op response, but no outbox event is appended for
  a no-op.
* Authoritative run queries retain project scope, optional task scope, current
  routing semantics, and the current 30-day ended-run visibility horizon. Old
  active runs are never removed merely because of age. Explicit terminal
  outcomes project as exited or lost even when the last provider lifecycle fact
  says working, waiting, or permission-required.
* Root Automation Attempts are unique by committed transition occurrence.
  Re-delivery returns the same root row. At most one retry child may be created
  for the same source attempt; repeated retry requests return that child. The
  root-attempt identity continues to group the latest retry outcome for Studio.
* The WorkTracker transition occurrence defined by Slice 1b becomes a direct
  Rust-to-Rust input. Eligible occurrences materialize a pending root Automation
  Attempt before any launch. Existing succeeded or failed attempts are final
  for that occurrence. Existing pending attempts are reconciled at startup
  rather than blindly relaunched.
* Every launch is represented by a durable Launch Effect with a predetermined
  effect ID and Agent Run ID. An Automation Attempt owns at most one Launch
  Effect, and the effect owns exactly one Agent Run identity. Explicit retry
  creates a new attempt/effect/run tuple; it never mutates the failed tuple into
  a different launch.
* A Launch Effect stores only the immutable, normalized launch intent needed to
  validate and reconcile the request: target, scope, selected provider and
  policy snapshot/reference, originating attempt or caller request, and stable
  identities. It must not persist credentials, bearer tokens, environment
  secrets, arbitrary executable paths, or a caller-supplied shell command.
* Launch Effect states distinguish prepared, leased/claimed, applied, failed,
  and cleanup-pending outcomes. Claims use a bounded lease and compare-and-set.
  Lease expiry makes an ambiguous effect eligible for reconciliation, not
  immediate respawn. Attempt count, last error, timestamps, and terminal
  evidence are durable diagnostics.
* Preparing a launch atomically inserts or validates the Agent Run, Launch
  Effect, initial lifecycle fact, and corresponding status event. A rollback
  exposes none of them. Only after commit may the terminal executor be woken.
* Until the Terminals slice, the Python terminal capability is an effect
  executor behind a narrow local compatibility port. It receives a validated
  effect identity and predetermined Agent Run identity, resolves only approved
  provider/runtime policy, creates or adopts the deterministic terminal
  runtime, and reports a typed outcome. It never edits an Agent Run,
  Automation Attempt, Launch Effect, or Status Event row directly.
* If the executor crashes after creating a terminal but before reporting
  success, reconciliation inspects the deterministic runtime identity. A live
  matching runtime is adopted and the original effect is marked applied. An
  absent runtime may be retried under the same effect and run identity. A
  conflicting runtime is a durable non-retryable failure requiring operator
  attention; it is never overwritten or duplicated.
* Launch failure records a typed failure on the effect and Automation Attempt
  and makes the Agent Run terminal according to current public semantics. If
  runtime cleanup cannot be confirmed, the effect and run remain
  cleanup-pending and reconciliation continues; application rows are not
  deleted while an external runtime may still exist.
* Run-scoped termination authorization remains in Rust. The authenticated
  principal determines the current Agent Run; callers cannot widen scope with
  an arbitrary ID. The still-Python terminal executor performs the native
  termination and returns evidence, while Rust records the authoritative
  terminal lifecycle and status event.
* External provider hooks remain outside the WebView trust boundary. During
  this slice, the existing normalized loopback/spool adapters may remain at the
  terminal boundary, but acknowledgement occurs only after the Rust lifecycle
  command commits. Packaged atomic spool files are drained idempotently. The
  future Terminals slice may move adapter ownership without changing the Runs
  command contract.
* Status Events are immutable domain-event envelopes. Each row has a database-
  assigned signed 64-bit cursor, event ID, project ID, event kind, payload
  schema version, subject identities, committed timestamp, and a validated
  payload. The cursor is globally increasing; project subscriptions filter it
  without renumbering. Cursor gaps caused by other projects are valid.
* A status-relevant mutation and its event append commit in the same database
  transaction. The event describes the durable fact, not a React Query key or
  UI action. No-op, rejected, or rolled-back commands append nothing.
* Realtime transport is a wake-up mechanism only. After a wake-up, the
  subscription reads rows above its last emitted cursor and orders them by
  cursor. Dropped, duplicated, delayed, or reordered wake-ups cannot lose or
  reorder durable events.
* The durable event families cover Agent Run lifecycle, terminal outcome,
  Automation Attempt outcome, WorkItem projection changes, and workflow-state
  projection changes. Each family carries enough identity, revision, and
  timestamp data for its current Studio behavior. Creation, deletion, reparent,
  archive, and other collection-membership changes remain explicitly marked.
* Document availability remains owned by the Documents capability until its
  migration slice. The GraphQL status adapter preserves the existing visible
  behavior, but reconnect correctness comes from refetching the authoritative
  document registry rather than pretending the legacy notification is durable
  Runs history. The reset/reconnect path therefore refreshes document holdings
  alongside other non-outbox projections.
* The subscription is project-scoped and receive-only. Its generated GraphQL
  result is a typed union containing an authoritative snapshot, durable event,
  caught-up cursor, reset-required control, and terminal error/completion
  outcomes. Stored event payload versions are mapped into the current GraphQL
  types; retained rows do not serialize internal Rust structs directly.
* The race-free connection sequence is fixed: validate project and cursor;
  register the live wake-up listener; begin a consistent read; capture the
  outbox high-water cursor and authoritative snapshot; query replay rows through
  that high-water mark; emit snapshot first; emit replay in cursor order; emit
  caught-up; then drain buffered and subsequently committed rows above the
  high-water mark. Listener registration and outbox reads overlap so a commit
  at any boundary is either replayed or drained, never lost.
* A fresh subscriber with no cursor receives a snapshot baselined at the
  captured high-water mark and then live events. A subscriber with a valid
  cursor receives the snapshot, events in `(cursor, high-water]`, the caught-up
  cursor, and then live events. Every accepted durable event advances the
  client's retained project cursor monotonically.
* Outbox compaction is project-aware and records a durable
  `compacted_through_cursor` watermark before deleting covered events. The
  shipping default retains at least 30 days of events and at least the newest
  100,000 events for a project; deletion occurs only when both protections are
  satisfied. These values are operational constants for this slice, not a
  user-facing setting.
* Replay is bounded by count and serialized size. If the requested cursor is at
  or below the project's compaction watermark, is ahead of the server, or would
  exceed the replay bound, the server emits reset-required with the current
  high-water cursor and reason instead of returning a partial history.
* On reset-required, Studio holds newer subscription events in cursor order,
  refetches canonical WorkItem collections/entities, workflow catalogue, run
  snapshot, Automation Attempts, and document registry for the project, installs
  the high-water cursor, then applies buffered events above it. Failure to
  refresh closes and retries the subscription; it never silently baselines
  stale state.
* Studio replaces the WebSocket constructor with a small status-subscription
  client inside the Agents status feature. The store retains one cursor per
  project, rejects backwards cursors, ignores events from a no-longer-owned
  subscription, and preserves reconnect backoff plus immediate reconnect on
  online/visibility signals.
* Snapshot reconciliation preserves the current race rules: a run omitted by
  a snapshot can be marked exited only when its local start is older than the
  snapshot stamp; an explicit terminal state wins over an older non-terminal
  delta; Automation Attempt lineages reconcile authoritatively; project switches
  discard queued prior-project results.
* WorkItem events continue to invalidate the individual canonical entity and,
  when membership changed, its containing collection. Invalidations remain
  batched. An item with an in-flight local mutation is not refetched until that
  mutation settles, preventing replay from overwriting optimistic state.
* The existing TauRPC subscription transport owns subscription IDs, channel
  delivery, cancellation, resource limits, and stale-registry cleanup. The
  Runs implementation supplies a GraphQL stream; it does not create a parallel
  native event transport.
* Structured failures distinguish bad project/cursor input, unauthorized
  scope, cursor reset, adoption unavailable, storage failure, incompatible
  event version, launch conflict, and internal failure. Transport errors do not
  expose database details, local paths, credentials, prompts, or terminal
  command lines.
* The cutover removes the shipping `/ws/status` route, Channels group dependency
  for status, WebSocket URL plumbing, and parallel frontend socket holding only
  after the GraphQL path is verified. There is no long-lived dual-publish or
  runtime fallback that would create two status authorities.
* Readiness requires successful Runs schema adoption, outbox/effect
  reconciliation, GraphQL query/subscription registration, and compatibility-
  executor health. Until readiness is published, callers receive structured
  unavailable errors; Studio must not silently reconnect to the legacy socket.
* Data adoption follows the migration's standard WAL-safe snapshot,
  classification, known-bridge, semantic validation, restart, and unknown-
  schema refusal process. After Rust accepts a Runs write there is no automatic
  downgrade to the Python writer.

## Testing Decisions

* Tests assert externally observable state, ordering, idempotency, and recovery,
  not private function calls, ORM query shapes, channel implementation, or
  internal task scheduling. A good test proves what a user, agent, operator, or
  supported capability can observe after a command, crash point, reconnect, or
  duplicate delivery.
* The highest Studio seam is the existing status-feature integration exercised
  through the desktop runtime contract. Acceptance cases provide a controlled
  GraphQL subscription, drive snapshots/replay/live/reset/project-switch
  sequences, and assert the rendered/store-facing behavior and canonical query
  invalidations. No new component-specific event bus is introduced for tests.
* The numbered Studio overhaul acceptance gate is updated for the transport and
  reconnect behavior. The full overhaul suite is required because this is a
  user-visible status behavior change even though its primary UI appearance is
  unchanged.
* Existing status-holding tests remain prior art for snapshot timestamp races,
  terminality tie-breaking, retry-lineage reconciliation, cursor retention,
  queued old-project frames, batched invalidation, and online/visibility
  reconnect. They are adapted to the GraphQL runtime rather than copied into a
  second WebSocket suite.
* Existing Runs lifecycle and DAO scenarios remain prior art for project/task
  scope, provider-session persistence, normalization, older-event rejection,
  ended-run authority, old-run visibility, and unknown-run acknowledgement.
  Equivalent Rust service and GraphQL query tests must cover the adopted data.
* Outbox integration tests commit each durable event family and assert that the
  authoritative row and event appear atomically with one increasing cursor.
  Rollback and no-op cases assert that neither appears. Multi-project tests
  prove global cursor gaps do not create false project gaps.
* Subscription integration tests mutate during every handshake boundary:
  before listener registration, after registration, during snapshot reads,
  between high-water capture and replay, during replay, and while buffered
  events are released. Each committed fact must appear exactly once in
  increasing cursor order after the snapshot.
* Reconnect tests cover no cursor, current cursor, disconnected mutation,
  duplicate cursor, cursor ahead of server, compacted cursor, replay count/size
  overflow, event-version incompatibility, and connection cancellation. Reset
  tests prove Studio refetches canonical holdings and applies only buffered
  events above the installed baseline.
* Stateful event-family tests cover same-group workflow rename/recolor, workflow
  reorder, WorkItem non-state edit, create, reparent, archive/delete,
  lifecycle change, terminal loss/exit, Automation Attempt failure/success/retry,
  and document-registry refresh. This closes the known snapshot/live race for
  every current status consumer.
* Launch-effect tests inject failures after each boundary: before preparation
  commit, after commit before wake-up, after claim, after terminal creation
  before acknowledgement, after acknowledgement before Automation Attempt
  projection, during cleanup, and during restart reconciliation. Assertions
  prove zero launch for rollback and exactly one deterministic runtime for every
  committed effect.
* Duplicate tests concurrently deliver one transition occurrence, one retry
  request, one effect wake-up, and one lifecycle fact from multiple workers.
  Database uniqueness and compare-and-set must produce one root attempt, one
  retry child per source, one Launch Effect, one Agent Run, and one terminal
  runtime.
* Compatibility-port tests use a fake terminal executor at the application
  boundary. They verify predetermined IDs, immutable validated intent, claim
  lease behavior, success/failure/cleanup outcomes, runtime adoption after an
  ambiguous crash, and refusal of conflicting identities. They do not invoke
  arbitrary commands from test payloads.
* Authorization tests prove GraphQL project scope, lifecycle ingress, effect
  executor calls, MCP run queries, and current-run termination cannot cross the
  authenticated run/project boundary. Logs and errors are checked for secret,
  token, prompt, local-path, and command-line leakage.
* Adoption fixtures cover current historical Agent Runs, ended and active runs,
  provider sessions, root and retry Automation Attempts, dismissed failures,
  pending attempts from transition occurrences, and partially reconcilable
  terminal evidence. IDs, timestamps, statuses, lineage, and query projections
  must remain stable across reopen.
* GraphQL schema, generated operation types, and TauRPC bindings participate in
  deterministic drift verification. Existing transport tests continue to prove
  subscription streaming, teardown, invalid IDs, resource caps, unavailable
  startup, and structured error propagation.
* Performance gates use realistic projects and event histories. Snapshot and
  bounded replay have query-count and latency budgets; compaction is incremental;
  a slow subscriber cannot block writes or unboundedly retain memory; project
  filtering uses indexed cursor access.
* Handoff requires focused Rust and TypeScript suites, generated-artifact drift
  checks, the complete Studio overhaul acceptance command, packaged restart and
  hook-spool scenarios, a verified copied-data adoption, and daily-driver
  dogfood through disconnect, sleep/wake, launch, retry, termination, and
  application restart.

## Out of Scope

* This stage does not create or break down Implementation tickets. Ticket
  decomposition belongs to the `Tickets` workflow stage.
* Migrating terminal-session persistence, tmux/native runtime ownership,
  provider command construction, viewer leases, libghostty rendering, or the
  terminal WebSocket is outside this slice. The compatibility executor is a
  temporary ownership boundary, not a terminal rewrite.
* Migrating dependency-graph scheduling, graph runs, serial/parallel execution,
  or general execution reconciliation is outside this slice. Only transition-
  occurrence consumption and Automation Attempt launch idempotency move because
  they are part of Runs ownership.
* Migrating document metadata, watchers, binary delivery, or worktrees is
  outside this slice. Their status-facing behavior is preserved through
  authoritative refresh until their own slices.
* Redesigning lifecycle vocabulary, retry UX, run-history UX, notification UI,
  or GraphQL entity shapes is outside this behavior-preserving port.
* A browser-only standalone GraphQL subscription server is not introduced. The
  production transport remains the managed in-process Tauri/TauRPC path.
* Production dual-write, shadow-write, a permanent Django status fallback, and
  automatic downgrade after Rust-authored Runs writes are explicitly excluded.
* Infinite event retention is not promised. The cursor watermark and reset
  protocol are the supported recovery behavior after compaction or excessive
  lag.
* PostgreSQL destination policy and post-migration GraphQL-native cache/schema
  optimization remain separate migration decisions.

## Further Notes

* This specification depends on the in-process GraphQL subscription transport
  from Slice 0, Rust WorkTracker ownership and transition occurrences from
  Slice 1b, and the migrated settings/launch-policy capability. It must preserve
  those ownership contracts rather than recreating their logic in Runs.
* The crucial invariant is: durable fact first, effect second, durable outcome
  third. Realtime messages only reduce latency. If any implementation path needs
  an in-memory notification to prove that a launch or lifecycle fact happened,
  that path does not satisfy this specification.
* The monotonic status cursor is not the WorkItem revision. WorkItem revisions
  remain domain concurrency/version facts and are carried inside relevant
  events; the status cursor orders heterogeneous project events for replay.
* The compatibility executor is deliberately narrow so the later Terminals
  slice can replace Python without changing launch identities, effect records,
  Runs commands, GraphQL status contracts, or Studio behavior.
