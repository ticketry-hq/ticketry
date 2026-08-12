# CODING-461 — Prevent live terminals from being shown as Exited

## Problem Statement

A Ticketry user can have a durable terminal session that is visibly present,
attached through tmux, and still interactive while Studio labels its agent run
as `Exited`. The incorrect lifecycle appears both on the terminal tab and in
the work-item surface because both presentations derive from the same pushed
run-liveness record.

The terminal viewer is not the lifecycle authority. Viewer attachment,
detachment, transport closure, or recovery says nothing by itself about whether
the hosted command or durable terminal session ended. The backend currently
weakens that boundary by making terminal discovery requests run a synchronous,
mutating reconciliation sweep before returning their persisted session list.
Task and scratch-workspace hydration can issue overlapping discovery requests,
so restoring a session can compete with repeated runtime inspection and
lifecycle publication. Once an erroneous terminal state reaches the shared
run-liveness feed, the tab and work-item status agree with each other but
disagree with the live runtime.

## Solution

Terminal discovery will become a prompt snapshot read of persisted active
sessions. After preparing that response, it will request a best-effort
background reconciliation instead of waiting for reconciliation inline.
Task-bound and scratch-session discovery will use the same behavior.

Background reconciliation will be single-flight within the backend process:
while one sweep is running, additional discovery requests will coalesce rather
than start competing sweeps. The existing terminal reconciler remains the sole
application policy that interprets terminal runtime observations, persists a
real hosted-command exit or missing durable session, performs cleanup, and
publishes the corresponding run-liveness event. Scheduling or reconciliation
failure will not make terminal discovery fail.

Studio will continue to render both terminal-tab and work-item lifecycle from
the pushed run-liveness holding. Its existing ordering rule must allow a newer
authoritative live record to supersede an earlier false `Exited` record, so the
two user-visible surfaces recover together without recreating the durable
session or refreshing the application.

## User Stories

1. As a Ticketry user, I want an interactive durable terminal session to be
   shown as live, so that the displayed lifecycle matches what I can use.
2. As a Ticketry user, I want the terminal tab and work-item status to agree
   with the backend's latest run-liveness fact, so that I do not have to decide
   which indicator to trust.
3. As a Ticketry user, I want a false `Exited` label to clear when a newer live
   status arrives, so that recovery does not require an application reload.
4. As a Ticketry user, I want restoring a task workspace to return its known
   terminal sessions promptly, so that lifecycle maintenance does not block the
   workspace from opening.
5. As a Ticketry user, I want scratch-workspace terminals to receive the same
   lifecycle treatment as task-bound terminals, so that terminal status does
   not depend on where the run was launched.
6. As a Ticketry user, I want multiple workspaces hydrating at once to avoid
   competing lifecycle sweeps, so that ordinary navigation cannot manufacture
   terminal-state changes.
7. As a Ticketry user, I want a genuinely exited hosted command to still become
   `Exited`, so that fixing false exits does not hide real completion.
8. As a Ticketry user, I want a genuinely missing durable terminal session to
   remain distinguishable as `lost`, so that disappearance is not presented as
   a clean hosted-command exit.
9. As a Ticketry user, I want a temporary failure to inspect tmux to leave the
   last known lifecycle intact, so that an observation error is not mistaken
   for terminal death.
10. As a Ticketry user, I want terminal discovery to remain usable when a
    background reconciliation cannot be submitted or completed, so that a
    maintenance failure does not become a workspace outage.
11. As a Ticketry user, I want disconnecting or replacing a terminal viewer to
    leave the durable session's lifecycle unchanged, so that viewer mechanics
    cannot mark my agent run as exited.
12. As a Ticketry user, I want the browser viewer and native terminal renderer
    to observe the same lifecycle result, so that renderer choice does not
    change status semantics.
13. As a Ticketry user, I want an actually stale persisted session to disappear
    after background reconciliation, so that prompt discovery does not make
    stale records permanent.
14. As a maintainer, I want terminal discovery and terminal reconciliation to
    be separate application operations, so that a read does not unexpectedly
    perform lifecycle mutation before it can respond.
15. As a maintainer, I want reconciliation requests to coalesce around one
    in-flight sweep, so that correctness does not depend on the number of
    simultaneous terminal-list requests.
16. As a maintainer, I want the established terminal reconciler to remain the
    only interpreter of runtime observations, so that lifecycle policy is not
    duplicated in API, viewer, or frontend code.
17. As a maintainer, I want background work to release thread-local database
    connections before and after reconciliation, so that repeated discovery
    does not leak or reuse unsafe connections.
18. As a maintainer, I want scheduling and reconciliation exceptions contained
    and logged, so that a best-effort maintenance path cannot fail terminal
    discovery.
19. As a maintainer, I want the public terminal-session and status-feed
    contracts to remain compatible, so that generated clients and existing
    consumers require no schema migration.
20. As a maintainer, I want one high-level regression case to cover both visible
    symptoms, so that the tab and work-item status cannot drift into separate
    fixes.

## Implementation Decisions

* The backend terminals capability owns a small reconciliation scheduler. API
  handlers may request reconciliation, but they do not inspect tmux, persist a
  lifecycle result, or publish lifecycle events themselves.
* Both task-bound terminal discovery and scratch-terminal discovery first read
  and materialize the persisted active-session payload. They then request a
  background sweep and return the already prepared payload without waiting for
  that sweep.
* The response may contain a session that the subsequent sweep proves stale.
  This is an accepted bounded race: attach already has a not-found path, while
  the status feed communicates the authoritative reconciliation result. A
  discovery read must not synchronously mutate lifecycle to avoid that race.
* The scheduler allows at most one reconciliation job in flight per backend
  process. Calls received during that job are coalesced and return immediately;
  they do not queue an unbounded backlog of duplicate full sweeps.
* The scheduler resets its in-flight state after success, reconciliation
  failure, or submission failure so later requests can trigger another sweep.
* Reconciliation runs outside the request path and applies database connection
  hygiene at the worker boundary. Failures are logged as operational evidence
  and otherwise remain best-effort.
* Existing terminal reconciliation semantics remain unchanged: `running`
  produces no terminal transition; hosted-command exit persists `exited` and
  its exit code when known; a missing durable session persists and publishes
  `lost`; an observation error preserves the last known state.
* The durable terminal session and agent run remain different domain objects.
  The terminal runtime supplies mechanical observations; reconciliation owns
  application interpretation; the status feed owns delivery; Studio owns only
  presentation.
* Viewer detachment, viewer process exit, PTY EOF, WebSocket closure, and
  reconnect exhaustion remain transport/viewer facts. None is promoted into a
  durable run `Exited` event without backend reconciliation.
* Studio continues to keep run liveness in its dedicated status-feed holding.
  The terminal tab and work-item lifecycle indicator derive from that same
  record rather than introducing a second lifecycle cache.
* Status ordering continues to be timestamp-based. A newer live record can
  recover an earlier terminal record; at equal timestamps a terminal record
  still wins, preserving the established protection against an old active
  frame reviving a run after a real terminal event.
* No database schema, public endpoint shape, generated SDK type, tmux session
  identity, or native-renderer boundary changes are required.
* No ADR is required because this restores the documented terminal/runtime
  ownership boundary rather than introducing a new architectural choice. The
  terminal glossary remains the vocabulary of record.

## Testing Decisions

* The primary seam is the existing numbered Studio terminal acceptance suite.
  One acceptance case will begin with a persisted terminal tab and run-liveness
  record showing `Exited`, deliver a newer authoritative `working` snapshot,
  and assert that the terminal tab and the work-item lifecycle presentation no
  longer show the false terminal state. The test observes rendered/derived user
  behavior, not store implementation details.
* Backend API tests will prove that task-bound and scratch discovery return the
  materialized persisted-session snapshot and request reconciliation without
  waiting for it.
* Backend API tests will prove that reconciliation submission failure leaves
  the successful discovery response intact.
* Scheduler tests will use a controllable executor seam to prove deferred
  execution, coalescing of overlapping requests, reusability after successful
  completion, recovery after reconciliation failure, and recovery after
  submission failure.
* Existing terminal application-service tests remain the prior art and
  regression coverage for authoritative `running`, `exited`, `lost`,
  unavailable-observation, persistence-before-cleanup, and lifecycle-event
  behavior. Those policies must not move into scheduler tests.
* Existing terminal viewer tests remain the prior art for detachment, viewer
  exit, PTY EOF, WebSocket reconnect, and native/browser fallback behavior.
  They must continue to prove that viewer transport does not own run liveness.
* The numbered Studio overhaul gate must include the updated terminal
  acceptance case and pass before implementation handoff.
* Tests will avoid timing-dependent real threads. Unit seams control job
  submission and completion deterministically; integration coverage verifies
  the request contract without depending on scheduler wall-clock timing.

## Out of Scope

* Replacing tmux, changing the pinned libghostty integration, or removing the
  browser terminal fallback.
* Redesigning terminal tabs, work-item lifecycle chips, colors, labels, or
  general status-feed UI.
* Changing how tmux determines whether a pane is dead or how exit codes are
  collected.
* Changing agent/provider completion hooks, provider resume semantics, or
  conversation identity.
* Adding periodic global polling, a durable job queue, cross-process locking,
  or a new orchestration service for reconciliation.
* Altering explicit terminal termination, tab dismissal, viewer leasing,
  scrollback, or terminal input behavior.
* Creating implementation tickets during the Spec stage.

## Further Notes

* The two visible symptoms have one cause because a terminal tab is a run and
  work-item lifecycle is aggregated from those same run records. A frontend-only
  badge override would conceal the shared-state error and is not an acceptable
  fix.
* Prompt discovery deliberately prefers returning a possibly stale persisted
  row over blocking on a mutating runtime sweep. The existing attach failure and
  pushed reconciliation event close that bounded window without conflating a
  read with lifecycle policy.
* The process-local single-flight guarantee addresses duplicate work within one
  desktop backend process, which matches Ticketry's supervised sidecar runtime.
  A distributed coordination mechanism is unnecessary for this scope.