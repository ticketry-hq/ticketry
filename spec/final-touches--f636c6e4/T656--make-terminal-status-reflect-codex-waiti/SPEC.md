# CODING-656 — Make terminal status reflect Codex waiting and stalled output

Status: Spec complete
Story: WorkTracker #656 (`43a775a7-3d02-4999-bd75-cbdfb8fe6759`)
Date: 2026-08-15

## Problem Statement

Ticketry currently presents terminal status with more certainty than its
evidence supports. Codex's `Stop` hook is normalized as `turn_complete`, even
though an open Codex terminal has normally stopped because Codex is waiting for
the user. A user who interrupts the hosted command with Ctrl-C can continue to
see `working`, and any terminal whose visible output stops changing can remain
labelled as running indefinitely.

Provider lifecycle and durable terminal runtime liveness do not answer whether
the terminal is producing output. Reusing the age of the last provider hook as
an inactivity timer would conflate those facts, discard useful provider state,
and still miss output that occurs without another lifecycle hook. Viewer
detachment is also not evidence that the durable terminal session or hosted
command ended.

The terminal tab's X is different: it is an explicit termination action. It
already uses the backend termination path and must continue to produce an
authoritative `exited` result.

## Solution

Map Codex `Stop` to the normalized `awaiting_input` event so an open Codex
terminal displays `needs_input`. Leave every other Codex mapping and every
other provider adapter unchanged.

Track terminal-output activity as a separate persisted fact for each durable
terminal session. Persist a compact output identity, a monotonic output
sequence, and `last_output_at`; do not persist another copy of the terminal
screen. Both browser and native terminal output paths report observations
through one backend terminal-activity operation. The operation advances the
sequence and server-owned timestamp only when the observed output identity has
changed, then publishes the updated run projection on the existing project
status feed.

Expose the provider lifecycle fact and the terminal-output activity fact in the
authoritative run projection. Studio derives the effective display state from
those facts. While a run is still live, reaching 60 seconds without a newer
output sequence changes its effective presentation to `stalled`. A changed
output observation immediately restores the latest provider-derived live
presentation and starts a new 60-second deadline. This overlay never writes a
provider lifecycle event or replaces the persisted last provider lifecycle
record.

Explicit termination and a confirmed hosted-command exit remain authoritative.
They cancel pending stall deadlines and project `exited`; no late output or
timer callback may move that run back to `stalled`. If Ctrl-C leaves the runtime
alive and output stops, the run converges to `stalled`; if the pane or hosted
command is actually dead, ordinary terminal reconciliation converges to the
authoritative terminal outcome instead.

## User Stories

1. As a Ticketry user, I want Codex `Stop` to display `Needs input`, so that the
   open terminal accurately tells me Codex is waiting for me.
2. As a Ticketry user, I want the other Codex lifecycle events to retain their
   existing meanings, so that correcting `Stop` does not change unrelated
   status behavior.
3. As a user of another supported agent, I want its hook mappings left alone,
   so that this Codex correction does not redesign Claude, Gemini, or agy.
4. As a Ticketry user, I want a live terminal whose output has not changed for
   60 seconds to display `Stalled`, so that it cannot look actively running
   forever without evidence.
5. As a Ticketry user, I want stall detection based on terminal output rather
   than provider-hook age, so that lifecycle silence is not mistaken for
   terminal silence.
6. As a Ticketry user, I want new terminal output to clear `Stalled`
   immediately, so that the status follows resumed work without a reload.
7. As a Ticketry user, I want the status restored after new output to be based
   on the latest real provider lifecycle record, so that a heuristic does not
   erase what the provider last reported.
8. As a Ticketry user, I want Ctrl-C followed by a live but silent runtime to
   converge to `Stalled`, so that an interrupted command no longer remains
   labelled `Working` indefinitely.
9. As a Ticketry user, I want Ctrl-C followed by an actual hosted-command exit
   to converge to `Exited`, so that runtime truth outranks the inactivity
   heuristic.
10. As a Ticketry user, I want clicking a terminal tab's X to keep explicitly
    terminating that durable terminal session, so that closing a tab has the
    same strong meaning it has today.
11. As a Ticketry user, I want an explicitly terminated terminal to remain
    `Exited`, so that a delayed output report or stall timer cannot resurrect
    it.
12. As a Ticketry user, I want a reconciled hosted-command exit to remain
    `Exited`, so that stale output activity cannot outrank runtime liveness.
13. As a Ticketry user, I want browser and desktop terminals to apply the same
    activity rules, so that status does not depend on which renderer I use.
14. As a Ticketry user, I want hidden retained native viewers to continue
    contributing output activity, so that navigation does not make their
    status stale merely because they are not visible.
15. As a Ticketry user, I want reconnecting or reloading Studio to reconstruct
    the same status from backend data, so that a browser-local timer is not the
    authority.
16. As a Ticketry user, I want a reconnect redraw that contains no changed
    terminal output not to manufacture fresh activity, so that reconnecting
    cannot hide a genuinely stalled run.
17. As a Ticketry user, I want a terminal that has not produced its first
    output within 60 seconds of creation to become `Stalled`, so that a silent
    launch has a bounded `Starting` or `Working` presentation.
18. As a Ticketry user, I want `Stalled` presented as an output-activity
    heuristic rather than a crash or exit, so that quiet work is not described
    as process failure.
19. As a maintainer, I want output activity recorded without duplicating the
    terminal buffer, so that status tracking stays compact and does not become
    a second terminal persistence system.
20. As a maintainer, I want provider lifecycle and terminal activity merged as
    independent ordered axes, so that timestamps from one axis cannot suppress
    valid updates from the other.
21. As a maintainer, I want one status projection to drive terminal tabs and
    aggregate work-item status, so that the same run cannot be `Stalled` in one
    surface and `Working` in another.
22. As a maintainer, I want the 60-second rule and precedence order tested with
    a controllable clock, so that the boundary is deterministic and fast in
    automation.

## Implementation Decisions

* Change only the Codex adapter's `Stop` mapping from `turn_complete` to
  `awaiting_input`. The shared lifecycle reducer already maps
  `awaiting_input` to `needs_input`; do not special-case Codex in Studio. Keep
  the Codex session-start, prompt-start, tool-use, and permission mappings
  unchanged, and do not change another provider's mapping.
* Add `stalled` to the render-facing run-status vocabulary. It is an effective
  terminal presentation, not a provider lifecycle event kind. There is no
  `stalled` hook payload, no fabricated `idle` event, and no write of
  `stalled` into the persisted provider lifecycle fields.
* Keep the two axes explicit in the run-status contract:
  * provider lifecycle state and its provider-event timestamp;
  * terminal output sequence, `last_output_at`, and the last compact output
    identity.
  The effective `state` may be projected for consumers, but the underlying
  provider state must remain available so a new output observation can restore
  it without waiting for another hook.
* Persist terminal-output activity with the durable terminal-session mirror,
  not with viewer state and not by changing the agent run's last provider
  lifecycle record. Add a migration that gives existing live sessions a safe
  baseline: sequence zero, no observed identity, and the session creation time
  as the inactivity origin until real output is observed.
* Use a compact, deterministic identity for the latest observed terminal
  output state and a monotonic per-session sequence. Comparing identities must
  distinguish changed output from an unchanged reconnect/redraw. Persist only
  the identity and counters/timestamps; never copy the full screen or
  scrollback into the database solely for stall detection.
* Introduce one terminal-activity application operation at the highest shared
  backend seam. Browser WebSocket output and the direct native viewer output
  path both report through it. The native path may use the authenticated local
  application surface, but it must not invent a second persistence or status
  algorithm in Rust or Studio.
* The activity operation is atomic and idempotent for one observation. It
  compares the incoming identity with the persisted identity; only a change
  increments the output sequence, stamps `last_output_at` from the backend
  clock, and publishes an activity update. Repeated chunks or reconnect
  hydration with the same identity do not extend the deadline.
* Coalescing high-volume terminal bytes is allowed before an observation is
  persisted, provided the first changed observation clears `stalled` without a
  perceptible delay and the stored identity represents the newest observation.
  Activity reporting must not block, reorder, or corrupt the terminal byte
  stream when persistence or status publication fails.
* Extend the existing project status snapshot and status-feed contract rather
  than adding a second client feed. Activity deltas must be self-sufficient or
  mergeable by output sequence, and snapshots must carry enough provider and
  output facts to reconstruct the same effective state after reload/reconnect.
  Regenerate the typed SDKs from the backend contract.
* Merge provider lifecycle and terminal activity independently in the Studio
  status holding. A lifecycle event is ordered by its lifecycle timestamp; an
  activity observation is ordered by output sequence. Do not compare
  `last_output_at` to the provider lifecycle timestamp to decide which fact is
  valid.
* Own the 60-second deadline in one status-feature coordinator keyed by durable
  agent-run identity. At `last_output_at + 60 seconds`, it may project
  `stalled` only if the run is still live and its output sequence is unchanged.
  New activity reschedules the deadline. Project switches, run removal, and
  terminal outcomes dispose obsolete timers.
* The backend snapshot computes the effective state at read time from its
  persisted facts. Studio also schedules the future deadline from those same
  facts so a connected UI changes at 60 seconds without waiting for another
  server message. This makes backend data authoritative while avoiding a
  per-run database write or fabricated lifecycle event when time alone passes.
* Use an inclusive boundary: a live run is stalled when the backend/client
  clock has reached or passed 60 seconds since `last_output_at` and no newer
  output sequence exists. Tests use an injected clock or fake timers; production
  code does not scatter literal timers across components.
* Precedence is explicit and centralized:
  1. a committed explicit termination or confirmed hosted-command exit
     projects `exited`;
  2. an existing authoritative missing-session outcome retains its terminal
     treatment;
  3. otherwise a live run beyond the unchanged-output deadline projects
     `stalled`;
  4. otherwise the latest provider lifecycle state is presented.
  A terminal outcome cancels the stall deadline and cannot be superseded by a
  late activity delta or timer callback.
* New output after `stalled` restores the latest provider-derived live state
  immediately. The activity update itself does not claim `working`; if the
  provider last reported `needs_input`, that remains the base state until a
  real provider hook reports something else.
* Keep terminal transport state independent. Viewer reconnecting, viewer EOF,
  detachment, and ownership replacement retain their present meanings and do
  not by themselves create `stalled` or `exited`.
* Render `Stalled` anywhere the shared run projection currently renders a run
  lifecycle, including the terminal tab and applicable aggregate work-item
  status. Its accessible description must say that output has not changed for
  60 seconds and must not describe the process as dead, failed, or completed.
* Update the terminal domain glossary with **terminal output activity** and
  **stalled terminal projection** so future work preserves the separation from
  provider lifecycle, transport state, and hosted-command exit. No new ADR is
  required: this decision extends the existing multi-axis terminal model and
  preserves the terminal-runtime authority already documented there.
* Keep new concerns in focused modules. Activity persistence/projection,
  activity observation, and Studio deadline management should not enlarge the
  already oversized terminal session store or turn the WebSocket consumer into
  a status-policy module.

## Testing Decisions

A good test controls time and observes public status contracts or mounted UI
behavior. It should assert output identity/sequence changes, projected state,
and terminal precedence rather than private timer collections, component-local
state, ORM call order, or exact hashing implementation.

* Update the provider hook contract test so Codex `Stop` produces
  `awaiting_input`, while an exhaustive mapping assertion proves every other
  Codex event and every non-Codex provider mapping remains unchanged.
* Test the terminal-activity application operation at the backend boundary.
  Cover first output, changed output, duplicate identity, atomic sequence
  advancement, backend-owned timestamps, an already-ended run, and persistence
  or publication failure that does not interrupt terminal streaming.
* Test both terminal output adapters against the shared operation: browser
  WebSocket output and direct native viewer output must report the same compact
  observation contract. Include retained/hidden native output and reconnect
  hydration that has an unchanged identity.
* Extend authoritative status API and status-stream tests. Snapshots and
  activity deltas must carry provider lifecycle plus terminal activity;
  snapshots before and after the 60-second boundary must project the correct
  effective state without changing the persisted lifecycle record.
* Add backend precedence tests for explicit termination, confirmed runtime
  exit, missing-session reconciliation, stalled live runtime, late activity,
  and a late provider hook after termination. Assert terminal outcomes cannot
  regress to `stalled`.
* Extend status-holding tests with independently reordered lifecycle and
  activity frames. Prove that a newer output sequence clears `stalled`, an old
  activity frame is ignored, and a lifecycle timestamp never substitutes for
  `last_output_at`.
* Add a new numbered Studio acceptance case at the next available overhaul
  number. With fake timers, render one Codex terminal and its aggregate
  work-item status, apply `Stop`, verify `Needs input`, advance to the exact
  unchanged-output deadline, verify `Stalled`, then deliver changed output and
  verify both surfaces recover without remounting or reloading.
* Extend that acceptance seam, or the established terminal-close case where it
  is clearer, to prove tab X terminates through the backend, removes/cancels the
  stall deadline, and leaves the authoritative run `Exited` after later timer
  advancement or output delivery.
* Cover reload/reconnect by seeding an authoritative snapshot with persisted
  provider lifecycle and activity facts on both sides of the threshold. The
  restored tab and aggregate status must agree immediately and continue from
  the persisted output sequence.
* Add a Ctrl-C-oriented backend/application case using the fake terminal
  runtime: a running pane with no new output becomes `stalled`; a pane observed
  exited becomes `exited`. Do not require a real provider process to test this
  state rule.
* Keep the numbered overhaul matrix current and run
  `npm run test:overhaul --workspace @worktracker/studio` before implementation
  handoff, along with affected backend terminal/run tests, Studio status and
  terminal tests, SDK contract generation checks, typecheck, and the focused
  native bridge tests.

## Out of Scope

* Creating Implementation tickets, child work items, dependency edges, or an
  implementation campaign during this Spec stage.
* Redesigning Claude, Gemini, or agy hook mappings.
* Changing any Codex hook mapping other than `Stop`.
* Treating every quiet terminal as a crashed process, failed run, completed
  turn, or exited session.
* Replacing tmux, the durable terminal runtime, terminal reconciliation,
  viewer ownership, or the native Ghostty renderer.
* Making viewer disconnect, EOF, navigation, or hidden presentation imply
  hosted-command exit.
* Replacing provider lifecycle with terminal-output activity or using
  lifecycle-event age as the stall timer.
* Persisting a duplicate full terminal screen, scrollback buffer, or raw output
  log solely to detect stalling.
* Changing the explicit terminal-tab X into a viewer-only dismissal.
* Adding a configurable stall duration in this release; the threshold is fixed
  at 60 seconds.
* Building process-failure diagnosis, automatic restart, automatic Ctrl-C
  recovery, or provider-specific stalled-run remediation.

## Further Notes

* **Terminal output activity** is evidence that the durable terminal's rendered
  output identity changed. It is independent of terminal input, viewer
  transport health, and provider lifecycle hooks.
* **Stalled terminal projection** is the heuristic effective status of a live
  run whose terminal output identity has not changed for 60 seconds. It is not
  persisted as the provider's lifecycle state and does not mean the hosted
  command is dead.
* The existing `quiet` lifecycle state remains a provider/inactivity vocabulary
  value. This Story introduces the user-visible `stalled` terminal-activity
  projection rather than silently redefining `quiet`.
* The Story's highest behavioral test seam is the shared project status
  projection consumed by both the terminal tab and work-item status. Lower
  adapter tests exist only to prove browser and native output both feed that
  one seam.
