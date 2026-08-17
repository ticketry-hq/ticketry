# Maintained Process-Group Lifecycle for Desktop-Owned Sidecars

## Problem Statement

Ticketry's desktop shell must reliably stop the backend and MCP sidecars that it
owns, including the PyInstaller descendants of each packaged process. Today the
shell implements Unix process-group creation, signalling, liveness checks, and
reaping directly. That code carries subtle platform and ownership semantics
which a maintained process-management library already provides, leaving
Ticketry responsible for low-level behavior that is easy to regress.

Replacing those mechanics must not change the desktop lifecycle contract. The
supervised pair still belongs to the Rust shell, MCP must stop before the
backend, graceful shutdown must escalate after a bound, and only processes
reachable through handles created by this supervisor may be signalled. Startup,
readiness, recovery, restart-budget, logging, redaction, and degraded-MCP
behavior must remain the same. Durable tmux sessions and unrelated machine
processes are outside this ownership boundary.

## Solution

Adopt `process-wrap` as the narrow process-ownership primitive beneath the
existing synchronous desktop supervisor. Each backend or MCP command will be
wrapped as the leader of its own Unix process group before spawn, and the
supervisor will retain the returned wrapped child handle. Graceful shutdown
will send SIGTERM through that owned handle, wait for the configured grace
period, then use the handle's group-aware kill and wait behavior to issue
SIGKILL when needed and reap the direct child.

Ticketry will keep its existing supervisor, service ordering, policies, events,
and public health behavior. The maintained library replaces process-group
creation and teardown mechanics; it does not become a new supervisor and does
not move lifecycle ownership into the Tauri frontend shell plugin. The process
handling will be isolated behind one focused Rust module so the oversized
supervisor does not absorb another concern.

`process-wrap` is preferred over retaining the current implementation because
it supplies maintained, composable `std::process` wrappers for process-group
creation, group signalling, forced termination, and waiting without requiring
Ticketry to adopt an async runtime. `processkit` is not selected because its
runner, cancellation, readiness, retry, and supervisor layers overlap the
broader supervisor that Ticketry intentionally retains.

## User Stories

1. As a Ticketry user, I want quitting the desktop to stop its backend sidecar, so that no application-owned service is left running.
2. As a Ticketry user, I want quitting the desktop to stop its MCP sidecar, so that the WorkTracker MCP endpoint does not outlive its owner.
3. As a Ticketry user, I want MCP to stop before the backend, so that MCP cannot issue requests while its backend dependency is being torn down.
4. As a Ticketry user, I want cooperative sidecars to receive SIGTERM, so that they can flush and exit cleanly.
5. As a Ticketry user, I want shutdown to wait only for a bounded grace period, so that an uncooperative sidecar cannot hang application exit indefinitely.
6. As a Ticketry user, I want a sidecar that ignores SIGTERM to receive SIGKILL after the grace period, so that quitting completes reliably.
7. As a Ticketry user, I want the full owned process group stopped, so that PyInstaller workers do not remain after their launcher is terminated.
8. As a Ticketry user, I want the direct sidecar child reaped, so that Ticketry does not leave a zombie process.
9. As a Ticketry user, I want a shutdown failure for MCP to be reported without skipping backend cleanup, so that one teardown error cannot leak the other sidecar.
10. As a Ticketry user, I want repeated shutdown requests to be harmless, so that overlapping lifecycle callbacks do not signal stale or unrelated processes.
11. As a Ticketry user running without MCP, I want backend shutdown to work normally, so that degraded MCP availability does not weaken core cleanup.
12. As a Ticketry user running the full supervised pair, I want both owned sidecars stopped and reaped, so that normal desktop exit is complete.
13. As the owner of another process on the machine, I want Ticketry never to discover and signal my process by PID, port, or executable name, so that desktop shutdown is isolated to its own children.
14. As a Ticketry terminal user, I want durable tmux sessions to survive sidecar shutdown, so that application service cleanup does not destroy terminal durability.
15. As a Ticketry user, I want startup failures to clean up the partially started owned sidecar group, so that a readiness or migration failure cannot leak descendants.
16. As a Ticketry user, I want a failed MCP startup to preserve the existing required-or-degraded policy, so that the process library choice does not change application availability.
17. As a Ticketry user, I want backend and MCP readiness semantics to remain unchanged, so that a spawned process is not mistaken for a serving sidecar.
18. As a Ticketry user, I want wedged-sidecar detection and recovery to remain unchanged, so that process-management refactoring does not reduce health recovery.
19. As a Ticketry user, I want recovery to remain bounded by the existing restart budget and backoff, so that a crashing sidecar cannot restart forever.
20. As a Ticketry user, I want the supervised pair to recover together, so that backend and MCP lifecycle compatibility is preserved.
21. As a Ticketry user, I want the sidecar log to remain rotating, size-capped, and secret-redacted, so that process wrapping does not change diagnostics or expose credentials.
22. As a support engineer, I want existing shutdown and failure events to retain their meanings, so that logs and service-health diagnosis remain comparable.
23. As a maintainer, I want low-level process ownership isolated from supervision policy, so that each module has one concern and can be reviewed independently.
24. As a maintainer, I want the synchronous supervisor retained, so that this focused lifecycle change does not introduce Tokio or rewrite readiness and recovery.
25. As a maintainer, I want process-group operations delegated to a maintained library, so that Ticketry no longer owns bespoke signal and wait implementations.
26. As a maintainer, I want one wrapped-child abstraction used by launch failure, recovery, explicit shutdown, and Drop cleanup, so that every exit path follows the same ownership rules.
27. As a maintainer, I want Drop to remain a best-effort fallback, so that ordinary unwinding still attempts cleanup when explicit shutdown was not reached.
28. As a maintainer, I want the macOS abrupt-owner-death limitation documented, so that a SIGKILL of Ticketry is not mistaken for a guaranteed whole-tree cleanup path.
29. As a maintainer, I want the current non-Unix fallback preserved unless separately designed, so that this Story does not silently claim stronger cross-platform behavior.
30. As a release engineer, I want the Rust dependency and toolchain compatibility checked in CI, so that adopting the library does not make packaged builds unreproducible.

## Implementation Decisions

- Select `process-wrap` and its synchronous `std` frontend. Enable only the
  features needed for the current target behavior, including the Unix process
  group wrapper; do not add Tokio solely for process management.
- Pin a compatible maintained release through Cargo's normal manifest and lock
  file workflow. The selected release must support the repository's Rust
  toolchain, build on the packaged desktop targets, and retain its license
  metadata in the dependency graph.
- Introduce one focused owned-sidecar process module. It owns command wrapping,
  wrapped-child access to standard streams, group signalling, bounded waiting,
  forced termination, and direct-child reaping. The supervisor owns policy and
  consumes this module rather than containing platform process primitives.
- On Unix, construct each backend and MCP sidecar as a new process-group leader
  with `ProcessGroup::leader()`. Keep one distinct group per sidecar; do not put
  the supervised pair into one shared group because shutdown order and
  per-service error reporting must remain observable.
- Retain only wrapped child handles returned from commands the supervisor
  itself spawned. Do not add PID lookup, port-owner discovery, process adoption,
  executable-name matching, or signalling by a persisted PID.
- Replace the raw `std::process::Child` inside the supervisor's running-child
  record with the owned-sidecar handle. The handle must provide the existing
  operations needed by readiness, logging, polling, shutdown, and tests without
  exposing unsafe access to the underlying child.
- Preserve stdout and stderr capture before readiness evaluation. The wrapper's
  standard-stream access feeds the existing log readers; control-line parsing,
  sidecar-log rotation, memory limits, and credential redaction do not move into
  the process library.
- Preserve explicit shutdown as a two-phase policy owned by Ticketry. Send
  SIGTERM to the entire owned group, poll for exit until the existing
  `shutdown_grace` deadline, and emit the existing graceful-shutdown event.
  When the group has not stopped by the deadline, emit the existing escalation
  event, kill the group through the wrapper, and wait for the direct child.
- Treat an already-exited/missing group during cleanup as stopped when the
  direct child has been reaped. Preserve the first meaningful teardown error,
  while still attempting all remaining owned cleanup.
- Use the same owned-sidecar teardown operation for readiness failure, failed
  MCP port commit, recovery replacement, explicit shutdown, and best-effort
  Drop. Short startup-cleanup bounds may remain distinct from the configured
  user shutdown grace, as they are today.
- Keep MCP-before-backend ordering in explicit shutdown, recovery cleanup, and
  Drop. If MCP teardown fails, continue to the backend and return the first
  error only after both cleanup attempts finish.
- Keep shutdown idempotent by taking each owned handle exactly once. A second
  shutdown observes no handles and succeeds without signalling any PID or
  process group.
- Keep the existing `SupervisorOptions`, `SupervisorEvent`, failure kinds,
  service-health projection, readiness probes, liveness probes, pinned ports,
  restart budget, recovery backoff, and give-up semantics unchanged.
- Preserve packaged environment sanitization and the fixed application-owned
  command table. The library wraps a command only after Ticketry has applied
  its fixed arguments, environment, standard I/O, and security posture.
- Preserve the existing non-Unix direct-child fallback. Cross-platform Job
  Object adoption is a separate decision unless required to make the current
  supported desktop target compile; this Story makes no new Windows lifecycle
  guarantee.
- Keep `libc` only if another native shell capability still requires it. Remove
  direct process-group calls and the dependency when it becomes unused; do not
  retain duplicate bespoke group signalling alongside `process-wrap`.
- Retaining the current implementation was considered and rejected. It has the
  smallest immediate diff but leaves Ticketry responsible for `kill`, process
  group existence, escalation, and reaping edge cases that the Story exists to
  transfer to a maintained dependency.
- `processkit` was considered and rejected for this increment. Adopting its
  async runner or supervisor would replace readiness, cancellation, retry,
  backoff, and ownership layers beyond teardown, increasing migration risk and
  duplicating Ticketry's established supervised-pair domain.
- Do not use Tauri's frontend shell plugin for backend or MCP lifecycle. That
  plugin would widen the webview boundary and move ownership away from the Rust
  supervisor that already owns application services.
- Do not change backend APIs, MCP tools, database schema, generated SDKs, Studio
  state, or user-visible UI as part of this refactor.

## Testing Decisions

A good test observes the desktop-owned sidecar lifecycle through the existing
supervisor contract. It launches real stub processes, asserts externally
visible ordering and resource cleanup, and avoids testing private library calls
or exact implementation types. The single highest seam is the current Rust
supervisor contract with its packaged-command stub; no frontend, backend API,
or new mock seam is needed.

- Preserve the normal start-and-quit contract and strengthen it to assert that
  a cooperative child observes SIGTERM, exits within the grace period, is
  reaped, and does not produce a forced-kill event.
- Preserve the uncooperative-child contract and assert the sequence SIGTERM,
  bounded wait, SIGKILL, and reap. Use a short injected grace period and assert
  eventual behavior rather than a scheduler-sensitive exact duration.
- Preserve the descendant-cleanup contract with a PyInstaller-shaped stub: the
  direct child spawns an uncooperative descendant in the same group, the
  descendant owns an observable loopback resource, and shutdown releases that
  resource.
- Add coverage in which the direct child and descendant take different exit
  paths, so a successful parent wait cannot hide a surviving owned descendant.
- Preserve the MCP-stop-failure contract: force the MCP handle into an
  already-reaped/error state, call shutdown, assert that backend SIGTERM still
  occurs, and return the MCP error only after backend cleanup.
- Preserve the idempotent-shutdown contract by shutting down twice and asserting
  that the second call succeeds with no new signal events.
- Exercise full-service shutdown and assert MCP termination is requested before
  backend termination, both direct children are reaped, and neither handle
  remains owned afterward.
- Exercise degraded-MCP shutdown with no MCP handle and assert the backend still
  receives the normal graceful-or-escalated teardown without an MCP signal.
- Launch an unrelated sentinel process outside the supervisor and assert it
  remains alive after shutdown. Use the same boundary to establish that no tmux
  session command or durable terminal process is targeted.
- Preserve startup-failure cleanup tests for readiness timeout, control-line
  failure, and failed MCP startup/port commit, asserting that partial owned
  groups release their observable resources.
- Preserve recovery tests for unexpected exit, wedged detection, paired
  recovery, pinned ports, restart budget, backoff, and give-up. These are
  regression coverage proving the maintained library did not absorb supervisor
  policy.
- Preserve log-capture, rotation, size-limit, disk-error, and secret-redaction
  tests using the wrapped stdout and stderr accessors.
- Add a Drop fallback contract that lets a live supervisor leave scope during
  ordinary unwinding and asserts best-effort cleanup. Do not simulate SIGKILL as
  a passing cleanup case because Drop cannot execute after abrupt owner death.
- Run the Rust shell's unit/contract tests and a packaged desktop smoke test on
  macOS. Run the repository's normal Rust compile/check path to validate the
  dependency on every supported build target.
- No Studio acceptance case is required because this specification deliberately
  changes no user-visible Studio UI behavior. If implementation changes service
  health, error presentation, or any other rendered behavior, update the
  numbered Studio acceptance gate and run the overhaul acceptance suite before
  handoff.

## Out of Scope

- Replacing Ticketry's broader supervisor, readiness protocol, liveness probe,
  recovery loop, restart budget, backoff, or service-health projection.
- Migrating the supervisor to Tokio or adopting `processkit`'s runner,
  cancellation, or supervision layers.
- Moving backend or MCP lifecycle ownership into Tauri's frontend shell plugin
  or exposing arbitrary command execution to the webview.
- Changing which sidecars exist, the packaged multi-call executable, MCP
  endpoint behavior, backend APIs, or launch credentials.
- Discovering, adopting, or terminating processes that were not spawned by the
  current desktop supervisor.
- Terminating durable tmux sessions or changing terminal-session ownership.
- Guaranteeing cleanup after `SIGKILL`, `panic = "abort"`, power loss, or an
  operating-system crash on macOS.
- Preventing a descendant from deliberately escaping the owned process group by
  creating a new session or process group.
- Expanding Windows lifecycle guarantees or introducing a Windows Job Object
  migration without a separate supported-platform decision.
- Adding or creating implementation tickets during the Spec stage.

## Further Notes

- The repository's desktop-shell glossary remains authoritative: **sidecar** is
  the backend or MCP process spawned and reaped by owned handle; **supervised
  pair** is the two sidecars governed together; **recovery**, **restart budget**,
  **give-up**, **readiness line**, **sidecar log**, and **service health** keep
  their existing meanings.
- `process-wrap` documents `ProcessGroup::leader()` for a new Unix process group
  and a wrapped child whose `signal`, `kill`, `try_wait`, and `wait` operations
  apply process-group behavior: <https://docs.rs/process-wrap/latest/process_wrap/>.
- The maintained library is an incremental fit because it supports the
  synchronous standard-library process API and explicitly leaves higher-level
  policy to its caller. Ticketry continues to own graceful timing, ordering,
  error precedence, readiness, and recovery.
- `processkit` documents a broader async command, containment, cancellation,
  readiness, and supervisor surface. That overlap is the reason it is deferred:
  <https://docs.rs/processkit/latest/processkit/>.
- Drop is only a best-effort fallback when Rust cleanup runs. A macOS owner
  terminated with SIGKILL cannot execute Drop, and POSIX process groups provide
  no parent-death guarantee for the entire tree. This limitation must be stated
  in code-level lifecycle documentation and any operator-facing shutdown notes;
  the refactor must not claim otherwise.
- The agreed test seam is the existing desktop supervisor contract. It is the
  highest seam that can prove signal order, bounded escalation, descendant
  cleanup, reaping, unrelated-process safety, full-service shutdown, and
  degraded-MCP shutdown without coupling tests to `process-wrap` internals.
