# Launch-path probes and end-of-life attribution

Story: CODING-1372

Related: CODING-1348 (agent-run visibility), CODING-1358 (launch-discovery
evidence), CODING-1359 (shared wake-up ownership decision).

## Problem Statement

A person reports being unable to launch claude agents. Studio cannot answer the
question, because nothing observes the part of the launch path where the failure
would live.

The existing launch-discovery trace covers only what happens **after** the launch
transaction commits: wake-up publication and receipt, durable outbox reread,
GraphQL frame delivery, Apollo insertion, and workspace render. Everything before
the commit — which surface asked for the launch, launch policy admission,
authority resolution and prompt construction, provider validation, executable
discovery, folder preflight, argv materialisation, terminal runtime spawn, and
prompt delivery — emits nothing at all. A launch that never comes up therefore
produces silence, and silence is indistinguishable from a launch that is merely
slow.

The recorded stage counts show how lopsided the instrumentation is. Across the
current development log the render half emits thousands of records while the
commit stage emits one, and no stage before the commit exists.

The same blindness applies at the other end of a run's life. An Agent Run's end
is stored as a status and a lifecycle state with no attribution, so Studio cannot
say whether a run ended because a person stopped it, because the agent
terminated itself through the worktracker MCP surface, because the provider
process crashed, or because a sweep marked a batch of runs dead. The stored
evidence shows all of these happening and none of them distinguishable:

- Hundreds of runs are stored as terminated with no exit code at all.
- Thirty-three runs were marked lost in a single instant, written in a timestamp
  format that differs from the normal lifecycle writer — evidence of a second,
  unattributed writer.
- Repeated batch sweeps end four to twenty-one runs at one identical instant.
- Every claude run that recorded an exit code recorded 143, the signalled-
  termination code, except one run that recorded 127 — command not found — and
  died two and a half seconds after starting. That single run is the only stored
  artefact in the whole dataset that unambiguously means "the agent could not be
  launched", and nothing surfaced it.

A person cannot distinguish a crash from their own stop action, and a developer
cannot tell an unattended mass termination from ordinary shutdown.

## Solution

Instrument the launch path end to end so that one development run produces a
single correlated, timed trace from the moment a launch is requested through to
the run being visible in the workspace — and, when the run ends, through to an
attributed end-of-life record.

The trace localises the fault instead of inferring it. For each Agent Run it
states the stages reached, the elapsed time between consecutive stages, the last
stage reached, and whether that stage completed, refused with a structured
reason, or simply stopped. A stall becomes visible as elapsed time; a refusal
becomes visible as a terminal record; a stage that ends the trace without either
is itself the finding.

End-of-life records carry an origin, so every run that ends can be attributed to
a person's stop action, an agent's own termination request, a workflow or
automation decision, a provider process exit with its exit code and signal, a
runtime-liveness sweep, or an unattributed end when nothing can be established.
Unattributed is a real, reportable outcome rather than a silent default.

This Story delivers the instrument and the evidence it produces. It does not
correct the launch path.

## User Stories

1. As a person launching an agent, I want a launch that fails to tell me it
   failed, so that I do not sit waiting for a run that will never appear.
2. As a person launching an agent, I want to know whether the failure happened
   before or after my request was accepted, so that I know whether retrying can
   help.
3. As a person whose agent never appeared, I want the reason recorded even when
   no error was shown to me, so that the problem can be investigated after the
   fact.
4. As a person who stopped an agent deliberately, I want that stop recorded as
   mine, so that my own action is not later investigated as a crash.
5. As a person whose agent died on its own, I want that recorded as a crash and
   not as a stop, so that I can tell the difference between my action and a
   defect.
6. As a person returning to the workspace after a runtime restart, I want runs
   ended by the restart distinguished from runs I ended, so that a restart does
   not look like lost work.
7. As a developer investigating the reported inability to launch claude agents,
   I want one timed trace per launch attempt, so that I can name the failing
   stage instead of guessing between candidate causes.
8. As a developer investigating a launch, I want the requesting surface recorded
   — launch picker, run-now, default coding-agent launch, dependency-graph
   execution, or a workflow auto-start binding — so that a surface-specific
   defect is visible as one.
9. As a developer investigating a launch, I want launch policy admission or its
   structured rejection recorded, so that a policy refusal is never mistaken for
   a missing agent.
10. As a developer investigating a launch, I want authority resolution and prompt
    construction recorded, so that a prompt that was never built is separable
    from a prompt that was never delivered.
11. As a developer investigating a launch, I want provider validation recorded
    with the requested provider slug, model, and reasoning level, so that an
    unregistered provider or rejected option is attributable.
12. As a developer investigating a launch, I want executable discovery recorded
    with the roots walked, the candidate chosen, and the duration of the version
    probe, so that a slow or hanging probe is visible as elapsed time rather
    than as an absent record.
13. As a developer investigating a launch, I want the durable operator approval
    consulted for the provider recorded, so that a stale approved path pointing
    at a missing executable is immediately obvious.
14. As a developer investigating a launch, I want folder preflight recorded, so
    that an unusable working directory is separable from a provider problem.
15. As a developer investigating a launch, I want argv materialisation recorded
    together with its refusals, so that an unavailable approved executable is
    named at the point it is rejected.
16. As a developer investigating a launch, I want terminal runtime spawn
    recorded, so that a runtime that never came up is separable from a provider
    that never started.
17. As a developer investigating a launch, I want prompt delivery recorded, so
    that a run whose terminal opened but whose agent never received its prompt
    is identified precisely.
18. As a developer investigating a launch, I want the pre-commit stages joined to
    the existing post-commit visibility stages under one Agent Run identity, so
    that one report spans the whole path.
19. As a developer investigating a launch, I want per-stage elapsed time and not
    only absolute timestamps, so that I can distinguish a stall from a failure
    without reading timestamps by eye.
20. As a developer investigating a launch, I want the report to name the last
    stage reached, so that "where it is not coming up" is the output rather than
    my inference.
21. As a developer investigating a launch, I want every stage to record the
    provider slug, so that a claude-only failure can be compared against codex
    behaviour at the same moment.
22. As a developer investigating a launch, I want a stage that refuses to emit a
    terminal record carrying its structured reason, so that silence is never the
    only signal of failure.
23. As a developer investigating a launch, I want a trace that ends without a
    terminal record to be reported as an incomplete trace, so that a stage which
    stops without refusing is still a finding.
24. As a developer investigating a run that ended, I want an end-of-life record
    carrying an origin, so that termination cause is stored rather than
    reconstructed.
25. As a developer investigating a run that ended, I want a person's stop action
    distinguished from an agent's own termination request through the
    worktracker MCP surface, so that self-terminating workflow stages are not
    counted as failures.
26. As a developer investigating a run that ended, I want provider process exits
    recorded with their exit code and signal, so that a command-not-found exit
    and a signalled termination are never conflated.
27. As a developer investigating a run that ended, I want runs ended by a
    liveness sweep attributed to that sweep, so that a batch of runs ending at
    one instant is legible as one event.
28. As a developer investigating a run that ended, I want the sweep to record how
    many runs it ended and why, so that a mass termination is auditable.
29. As a developer investigating a run that ended, I want an end that cannot be
    attributed to be recorded as unattributed, so that the gap is visible rather
    than defaulted into a plausible-looking origin.
30. As a developer reviewing the evidence, I want the trace and the end-of-life
    origin to share the Agent Run identity, so that a launch failure and an early
    death are one story.
31. As a developer reviewing the evidence, I want the report to work for a run
    that never reached commit, so that the most severe failures are not the ones
    the report cannot describe.
32. As a maintainer, I want the probes to add observation only, so that
    instrumenting the launch path cannot change whether a launch succeeds.
33. As a maintainer, I want the probes to carry no prompt text, credentials,
    environment, or argv values that could leak a secret, so that traces are
    safe to attach to a Work Item.
34. As a maintainer, I want the record contract to match the one already
    established for launch discovery, so that new stages join the existing trace
    rather than starting a parallel one.
35. As a maintainer, I want the correlation report to be a pure transformation
    over records, so that it is testable without a running desktop application.

## Implementation Decisions

### Reuse the existing trace, extend its stages

The launch-discovery record contract stays as established: an ISO timestamp,
project identity, Agent Run identity, cursor, connection generation, renderer
instance, and runtime instance, with a stage that cannot know a field writing
null rather than omitting it. Backend wake-up records keep carrying the wake-up
authority identity. New stages join this contract; no second trace format is
introduced.

Both existing recorder seams are reused unchanged — the backend diagnostics
recorder and the frontend recorder factory. Neither is redesigned. The frontend
recorder already injects its clock and its writer, and the backend recorder
already routes to the shared development log; records from both halves already
land in the same sink, so stitching one trace across the process boundary needs
no new transport.

### Stages to add, in path order

The pre-commit half is instrumented at these stages, each recording admission or
refusal, and each carrying the provider slug and the requested scope:

1. **Launch requested** — the initiating surface, the requested provider, model,
   reasoning level, scope, and target Work Item.
2. **Launch policy evaluated** — admission, or the structured rejection reason.
3. **Authority resolved** — authority establishment and prompt construction, as
   two separately observable outcomes.
4. **Provider validated** — provider registration and option validation.
5. **Executable resolved** — whether a durable operator approval was consulted,
   the trusted roots walked, the candidate selected, and the version probe's
   outcome and duration.
6. **Working directory preflighted** — folder admission or refusal.
7. **Argv materialised** — argv construction and its refusals, including an
   unavailable approved executable.
8. **Terminal runtime spawned** — runtime creation outcome.
9. **Prompt delivered** — whether the constructed prompt reached the agent.

These join the existing post-commit stages, which are unchanged: launch
transaction committed, wake-up published, wake-up received, durable event reread,
GraphQL frame delivered and received, Apollo run or event applied, and workspace
render committed.

Stage naming follows the existing convention of past-tense hyphenated event
names, so new stages read as peers of the ones already emitted.

### Correlation before an Agent Run identity exists

The earliest stages run before an Agent Run identity exists, so the trace cannot
key on it there. Each launch attempt is assigned a launch attempt identity at
the requesting surface. Every pre-commit record carries it, the commit stage
records both the attempt identity and the Agent Run identity it produced, and the
reader joins the two halves on that pairing. A launch that fails before commit
therefore still produces a complete, self-consistent trace under its attempt
identity — which is the case that matters most and the one a run-keyed trace
could not express at all.

### End-of-life attribution

An Agent Run's end gains a recorded origin alongside the existing status and
lifecycle state. The lifecycle state vocabulary is unchanged; origin is a
separate, additive dimension, because the existing states already collapse
distinct causes onto one transport meaning and widening them would change
behaviour rather than observe it.

The origin values are: a person's stop action; an agent's own termination
request through the worktracker MCP surface; a workflow or automation decision; a
provider process exit; a runtime-liveness sweep; and unattributed.

A provider process exit additionally records its exit code and, where the
platform reports one, its terminating signal, so that a command-not-found exit
and a signalled termination remain distinct. Signal-derived codes are recorded as
observed rather than normalised away.

A liveness sweep records one record for the sweep itself, carrying its cause and
the number of runs it ended, plus the origin on each affected run. This makes a
batch of runs ending at one instant legible as one event rather than as many
independent deaths.

Unattributed is written whenever no origin can be established. It is never
inferred from circumstance, and it is reported as its own outcome, because an
unattributed end is a gap in the instrument and must look like one.

### The correlation reader

Exactly one new seam is introduced: a pure function that takes a collection of
trace records and produces an ordered, timed report for one launch attempt or
Agent Run. It computes per-stage elapsed time between consecutive stages, names
the last stage reached, classifies the trace as completed, refused with a
structured reason, or incomplete, and appends the end-of-life origin when the run
has ended. It performs no I/O, reads no clock, and holds no state, so it is
testable in isolation.

A development-only entry point reads the development log and renders that report.
The reader is the product of this Story; the log remains the raw evidence.

### Constraints

Probes observe and never decide. No probe may alter control flow, gate a launch,
retry, or change timing beyond the cost of emitting a record. A probe that cannot
emit is silently skipped rather than failing the launch it observes.

No probe records prompt text, credential material, environment values, or raw
argv contents. Argv is described by its shape and refusal reasons, not its
values. Traces must remain safe to attach to a Work Item.

Development form only. No production surface, no user-facing UI, and no change to
launch behaviour.

## Testing Decisions

A good test here asserts externally observable behaviour: that a stage emits a
record with the agreed contract, that a refusal carries its structured reason,
that the reader turns a set of records into the right ordered report with the
right last-stage verdict, and that an end-of-life origin is attributed correctly.
Tests must not assert probe call ordering inside a function, internal helper
shapes, or log formatting incidental to the contract.

Prior art to follow:

- The existing launch-discovery tracer test is the model for record-contract
  assertions on the frontend seam. It injects the clock and the writer and
  asserts the exact emitted record, including that unavailable correlation
  fields stay explicitly null. New frontend stages extend this pattern.
- The prepared-launch-effects integration test is the model for backend launch
  pipeline assertions with a real database and a substituted terminal world.
- The crash-safe launch-effect reconciliation test already substitutes a terminal
  world and a probe verdict, and already exercises lease expiry. It is the
  natural home for sweep-attribution assertions, because it can drive a sweep
  deterministically.
- The launch planning golden tests are the model for argv and provider
  validation assertions, and the existing launch policy resolution and
  interactive launch authority tests cover the policy and authority stages.

Modules under test: the correlation reader, each newly probed launch stage, the
end-of-life origin recorder, and the sweep attribution path.

The reader carries the heaviest test burden, being pure. Its cases include a
complete trace through to workspace render; a trace refused at each pre-commit
stage; a trace that stops with no terminal record, asserted to report as
incomplete; a trace that never reached commit, keyed only by launch attempt
identity; a trace whose stages arrive out of order, asserted to be reported in
path order; and a trace joined to each end-of-life origin, including
unattributed.

One acceptance-level assertion covers the Story's purpose directly: a launch
driven through the development harness produces a report naming the last stage
reached, with per-stage elapsed times, for both a successful launch and a launch
made to fail at a chosen stage.

Deliberately not tested: absolute latency thresholds. This Story measures and
reports timings; it sets no budget, and a timing assertion would make the
instrument flaky without making it more truthful.

## Out of Scope

Fixing the launch defect. This Story produces evidence, not a correction.

The uncorrected duplicate wake-up channel root cause established in CODING-1358
stays uncorrected here: each construction of the runs services creates a separate
status wake-up channel, so a launch publishes on one while the project
subscription waits on another, and the subscriber finds the launch on its safety
reread. CODING-1359 selected shared wake-up ownership as the correction. That
work remains separate, and this Story must not quietly perform it.

Also out of scope: any change to the lifecycle state vocabulary or its transport
mapping; any change to launch behaviour, ordering, or timing; any production or
user-facing surface for the trace; retention, rotation, or shipping of trace
records beyond the existing development log; and instrumentation of provider
internals beyond the boundary Studio controls.

## Further Notes

The configuration explanations for the report were checked and eliminated before
this spec was written: the claude provider is activated in the provider
catalogue, its model rows are present, the claude executable is installed inside
a trusted discovery root and answers a version probe promptly, no stale operator
approval exists in the live data directory, and every stored claude launch effect
is in the applied state with no error code. Claude launches were succeeding while
the investigation ran. The defect is therefore not a missing prerequisite, which
is precisely why the trace is the deliverable.

The single stored claude run that exited 127 two and a half seconds after
starting is the closest thing to a reproduction the dataset contains, and the
historical prompt-delivery failure recorded on another claude run is the closest
thing to a mechanism. Neither was surfaced by any existing instrument. Both are
the shape of evidence this Story is meant to make routine.

The correlation questions from the original triage remain the checklist to apply
once a trace exists: which surface initiated the launch, what the failure looked
like to the person, what error text appeared, whether codex worked at the same
moment, which model was selected, whether the profile was a hydrated development
profile, and the timestamp of an occurrence.
