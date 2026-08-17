# CODING-689 — Unstick a subtree run from its own button

## Problem Statement

A subtree run — parallel **Run subtree** or bounded **Run serially** — works
until it doesn't. A user walks away from a campaign, comes back later, sees that
nothing is running anywhere, and presses the button that started it. Instead of
starting the work that is plainly waiting, the request is refused and a toast
reports that the run could not be started. Pressing again changes nothing.
Nothing the user can see explains the refusal, and no amount of pressing
resolves it; the campaign is dead until the user resets the subtree or abandons
it.

The refusal is decided entirely from stored launch facts. A campaign is
considered busy when *any* task it ever launched still has an agent run or
terminal session recorded as active. When one of those recordings is stale — an
agent that exited without its ending being recorded — a work item that finished
long ago holds the whole campaign hostage. The blocked work item may have
nothing to do with the stale one. The user is told the campaign is running while
looking at a screen that proves it is not.

The refusal is also decided *before* the campaign looks at its graph at all, so
the one moment the user asserts that nothing is running is the one moment the
system never re-examines anything.

## Solution

Pressing the button asks the campaign to make progress now, and it answers
honestly.

The press advances the campaign the user already has. It does not refuse on the
strength of a launch record, and it does not tear the campaign down and rebuild
it. The same graph run, the same launch ledger, the same execution mode.

To decide what to start, the campaign looks at the work rather than at its own
bookkeeping. A work item can be started when its own work is unfinished, every
blocker it declares is satisfied, and no agent run or terminal is live *on that
work item*. Liveness becomes a fact about the work item being considered, not a
fact about the campaign as a whole — so a stale record on a sibling stops
mattering, and an agent the user launched by hand on that work item is respected
even though the campaign never started it.

A serial campaign starts the lowest-numbered startable child. A parallel
campaign starts all of them. When there is genuinely nothing to start, the
button says so instead of claiming that a run started.

Automatic advancement is deliberately untouched. The campaign still cannot retry
or skip a child on its own; the user pressing the button remains the only thing
that can revive stalled work.

## User Stories

1. As a Ticketry user, I want pressing Run serially on a stalled campaign to
   start the next available work item, so that I can recover a campaign without
   understanding why it stalled.
2. As a Ticketry user, I want pressing Run subtree on a stalled campaign to
   start every available work item, so that parallel campaigns recover the same
   way serial ones do.
3. As a Ticketry user, I want a stale launch record on a finished work item to
   stop blocking an unrelated work item, so that one bad recording cannot end a
   campaign.
4. As a Ticketry user, I want the press to reuse my existing campaign rather
   than replacing it, so that its execution mode, provider override, and launch
   history survive the recovery.
5. As a Ticketry user, I want the press to be safe to repeat, so that pressing
   twice does not start the same work twice.
6. As a Ticketry user, I want a work item that already has a live agent to be
   left alone, so that recovery never puts two agents on one work item.
7. As a Ticketry user, I want an agent I launched by hand on a work item to
   count as live, so that recovery does not start a second agent beside it.
8. As a Ticketry user, I want a serial campaign to start the lowest-numbered
   startable child, so that recovery follows the same deterministic order the
   campaign already follows.
9. As a Ticketry user, I want a parallel campaign to start every startable
   child, so that recovery preserves the fan-out I chose.
10. As a Ticketry user, I want blockers to gate a recovery launch exactly as
    they gate an ordinary one, so that recovery cannot start work too early.
11. As a Ticketry user, I want blockers outside the subtree to remain
    authoritative during recovery, so that a narrower view cannot release work
    that is genuinely blocked.
12. As a Ticketry user, I want completed, Review, cancelled, and archived work to
    remain satisfied during recovery, so that finished work is never restarted.
13. As a Ticketry user, I want a work item whose previous agent ended without
    finishing the work to be startable again, so that a failed attempt can be
    retried by pressing the button.
14. As a Ticketry user, I want retrying a work item to update its existing
    launch record rather than adding another, so that the ledger keeps one truth
    per work item.
15. As a Ticketry user, I want the response to tell me when nothing could be
    started, so that I am not told a run started when none did.
16. As a Ticketry user, I want a successful press to keep reporting success as it
    does today, so that the ordinary case reads no differently.
17. As a Ticketry user, I want the press to still be refused when subtree
    execution is not enabled for the work item's issue type and state, so that
    the workflow gate remains the single launch authority.
18. As a Ticketry user, I want both buttons to remain visible under the same
    single subtree-run capability, so that recovery introduces no new setting.
19. As a Ticketry user, I want an unarmed work item's first press to arm a
    campaign exactly as it does today, so that starting fresh is unchanged.
20. As a Ticketry user, I want a campaign whose work is entirely finished to tell
    me there is nothing to start, so that a completed subtree is
    distinguishable from a stalled one.
21. As a Ticketry user, I want a campaign whose remaining work is all blocked to
    tell me there is nothing to start, so that waiting on dependencies is
    distinguishable from being broken.
22. As a Ticketry user, I want each button to keep its own pending state, so
    that pressing one does not appear to disable the other.
23. As a Ticketry user, I want the buttons to keep their distinct accessible
    names and pending labels, so that keyboard and assistive-technology use is
    unchanged.
24. As a Ticketry user, I want a campaign that is genuinely progressing to be
    unaffected by an extra press, so that impatience cannot disturb healthy work.
25. As a Ticketry user, I want automatic advancement to keep working as it does
    today, so that a healthy serial campaign still walks its subtree without me.
26. As a Ticketry user, I want the campaign to still refuse to retry or skip a
    stalled child on its own, so that unattended execution never guesses whether
    unfinished work should be repeated or abandoned.
27. As a Ticketry user, I want Reset subtree to keep clearing a campaign without
    moving work items or starting agents, so that the existing escape hatch is
    unchanged.
28. As an API client, I want the execute request to keep its current shape and
    response, so that recovery requires no contract change.
29. As an API client, I want the launched work items to be reported in the
    response, so that a caller can tell an effective press from an inert one.
30. As a maintainer, I want one startability rule shared by both execution
    modes, so that the modes cannot drift apart.
31. As a maintainer, I want the per-work-item liveness rule expressed once, so
    that the campaign and the presentation cannot disagree about what "running"
    means.
32. As a maintainer, I want advancement to remain serialized per campaign root,
    so that a press racing an automatic advancement still produces one launch.
33. As a maintainer, I want the launch ledger's uniqueness guarantee to remain
    the final duplicate-launch guard, so that concurrency bugs cannot produce two
    agents on one work item.

## Implementation Decisions

* The manual execute request is the only caller whose behaviour changes.
  Automatic advancement — the state-change observation and the agent-run
  termination observation — keeps its current rule verbatim.
* Remove the campaign-wide active-launch refusal from the manual request. The
  request no longer produces a conflict for a campaign that already exists; it
  advances that campaign instead.
* Remove the ledger-clearing revival step from the manual request. The campaign
  header and every launch fact survive the press. The header still refreshes its
  execution mode, module, and provider override from the request, as it does
  today, so pressing the other button switches an existing campaign's mode.
* Introduce a single **startable child** rule, replacing the ledger-based
  eligibility rule for the manual path: a direct child is startable when its own
  work is unsatisfied, every blocker it declares is satisfied, and no live agent
  run or terminal session exists for that child. The existing satisfaction
  predicate, blocker ownership, out-of-subtree blocker handling, archived-work
  exclusion, and direct-child-only boundary are unchanged.
* Per-child liveness is asked of the child, not of the campaign's launch ledger.
  Any active agent run recorded against that work item counts, whether the
  campaign started it or the user did. This deliberately widens what blocks a
  launch while narrowing what blocks the campaign.
* Serial selection over startable children keeps its current ordering:
  ascending stored sequence number, then opaque task id as tie-breaker. The
  ticket number is read from the stored sequence, never parsed from a display
  key. Parallel selection takes every startable child.
* The serial frontier check no longer participates in the manual path. Per-child
  liveness already prevents a second agent on a running child, and campaign-wide
  liveness is exactly the condition that produced the deadlock. The frontier
  remains in force for automatic advancement.
* Retrying a child updates its existing launch fact in place. The launch ledger
  is keyed by work item, so a retry replaces that row's agent run reference
  rather than inserting a second row. Its uniqueness remains the final
  duplicate-launch guard.
* A launch failure during a manual advancement records no launch fact for that
  child and does not fall through to a higher-numbered child in a serial
  campaign, matching current behaviour.
* Advancement stays serialized per campaign root across manual requests and
  lifecycle observations, so a press racing an automatic advancement cannot
  produce two launches.
* The HTTP contract does not change. The response already reports the launched
  work items, and an empty list is the fact that distinguishes an inert press.
  No new field, status code, error code, or route.
* The remaining refusals are unchanged: unknown work item, subtree execution not
  enabled for the issue type and state, no module ancestor, and an empty graph.
* Studio's subtree-run hook currently discards the response and reports success
  unconditionally. It must read the launched work items and report that nothing
  was started when the list is empty. Both controls share this behaviour through
  the one hook; each keeps its own in-flight guard, accessible name, and pending
  label.
* Scheduling policy stays in the execution capability, workflow authorization
  stays in WorkTracker, agent and session liveness stay with runs and terminals,
  and the presentation change stays in the work-item feature. No new module is
  required in Studio; the backend selection policy stays in its existing
  single-purpose scheduling module rather than growing the driver.
* No ADR. The change is reversible, introduces no new domain concept, and moves
  no ownership. The execution capability's context glossary is amended when the
  behaviour ships: the *Launch fact* entry stops describing itself as the
  relaunch guard for the manual path, and the *Serial frontier* entry records
  that it governs automatic advancement only.

## Testing Decisions

A good test here observes what a user or an API client can observe: which work
items a press starts, which it declines to start, what the campaign looks like
afterwards, and what the user is told. Tests must not assert the shape of the
selection loop, the names of internal helpers, or component-local state.

* The **execution driver's existing graph tests** are the primary seam and the
  highest practical one for scheduling. Prior art: the serial and parallel graph
  test modules added for the serial-execution work, which drive the public
  execute and advance entry points with a fake spawn and assert launched ids.
* At that seam, cover: a stale active launch record on a satisfied sibling no
  longer prevents a press from starting the next work item; a press on an
  existing campaign starts work rather than producing a conflict; the campaign
  header and unrelated launch facts survive the press; a child with a live agent
  run is not started; a child whose live run was started outside the campaign is
  not started; a child whose previous run ended without finishing is started
  again and its launch fact is updated rather than duplicated; serial starts
  exactly the lowest-numbered startable child; parallel starts every startable
  child; blockers, out-of-subtree blockers, satisfied children, and archived or
  cancelled children behave exactly as they do today; a press that can start
  nothing returns an empty result; and a spawn failure on the serial candidate
  records nothing and does not fall through.
* At the same seam, prove the untouched half: automatic advancement on state
  change and on agent-run termination still refuses to retry a child it already
  launched, and an ended-but-unsatisfied child still holds the serial frontier.
  This is the regression that protects the deferred work.
* Exercise a manual press racing a lifecycle advancement against one campaign
  root and assert exactly one launch.
* Extend the existing execution API tests to drop the conflict case and assert
  that an existing campaign now receives a successful response, including the
  empty-launch case. Assert the remaining refusals are unchanged.
* Update the numbered Studio subtree-execution acceptance case in the mounted
  application seam: a press whose response reports launched work items reports
  success, and a press whose response reports none reports that nothing was
  started. Both controls keep their independent pending behaviour and both still
  disappear after a stale capability refresh disables subtree execution.
* Run the mandated Studio overhaul suite before implementation handoff, plus the
  affected backend execution tests, API tests, Studio unit tests, and Studio
  typecheck as proportional regression coverage.

## Out of Scope

* Changing automatic advancement in any way. Retry caps, attempt counters,
  skipping a stalled child, and self-healing campaigns are a separate Story in
  Ideas.
* Verifying a stale launch record against the terminal runtime at press time.
* Adopting or sweeping terminal sessions recorded under a runtime namespace the
  current process does not own.
* Ending an agent run that has no active terminal session during reconciliation,
  even though that is a known source of stale records.
* Any override flag, confirmation dialog, or second button for forcing a launch.
* Naming specific work items, run ids, or stale-record counts in user feedback.
* Recursively launching grandchildren or changing the direct-child boundary.
* Removing or renaming either existing button, or adding a serial-specific
  workflow capability.
* Changing dependency storage, workflow transition policy, subtree reset
  semantics, archive semantics, or launch-binding resolution.
* Changing the terminal runtime, the durable session model, or the
  Tauri/webview boundary.

## Further Notes

* The deadlock needs no race to occur. A launch record whose agent exited
  without its ending being recorded is permanent for two structural reasons that
  this Story deliberately does not fix: an agent run is only ended when its
  terminal session is also ended, so a run with no active terminal session is
  never ended; and reconciliation only observes sessions recorded under the
  runtime namespace the current process owns, so a session left behind by a
  different profile is invisible to it. Both are recorded here because they
  explain why "press it again tomorrow" never worked, and because either would
  be a reasonable follow-up.
* The essential move is a change of authority. Today the campaign asks its own
  bookkeeping whether it is busy; afterwards it asks the work whether anything
  can start. Bookkeeping that is wrong then costs one work item instead of the
  whole campaign.
* Widening liveness to any agent run on the work item is a small behaviour
  change beyond recovery: the campaign will now decline to start a child the
  user is already working on by hand. That is the desired reading of "is
  anything running on it".
* Because the press no longer clears the ledger, the launch ledger becomes a
  record of what was started rather than a gate on what may start. Reset subtree
  remains the way to discard it.
