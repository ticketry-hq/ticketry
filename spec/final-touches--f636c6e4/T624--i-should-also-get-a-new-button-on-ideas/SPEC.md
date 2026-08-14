# CODING-624 — Run Now

## Problem Statement

Ticketry's Story workflow routes every idea through refinement: an idea captured
in `Ideas` is triaged into `Grill` or `Spec`, grilled into a specification, split
into Implementation children, and only then implemented. That pipeline exists
because most work benefits from it.

Some ideas do not. A one-line change a user could describe in a sentence still
has to pass through three launchable stages, each with its own agent session and
deliverable, before anything is built. The user's only escape today is the
Instant Change flow, which is taskless and scratch-scoped: the work happens, but
no work item records it, the run is not attached to the idea, and the captured
Story sits in `Ideas` afterwards as an orphan the user must close by hand.

So a user with a small idea must choose between refinement they do not need and
an untracked run that leaves their backlog wrong. There is no way to say "this
one is small — just build it" and keep the idea as a first-class work item.

## Solution

Add **Run Now**: one action that sends an idea straight into implementation.

From the selected work item's Details surface, a `Run now` control moves the
Story from `Ideas` to `Implement` and launches a task-scoped agent run bound to
that Story, skipping `Grill`, `Spec`, and `Tickets`. The work stays tracked — it
keeps its ticket number, its description, its row in the Stories pane, its
lifecycle chicklets, and it advances to `Review` when the run completes, exactly
as any other implemented Story does.

Run Now is offered only where the project's workflow permits a human to move
directly from the item's current state into `Implement`, so workflow
configuration alone decides whether it exists. It is also exposed as an MCP tool,
so the `Ideas` triage agent can route genuinely trivial work through it instead
of manufacturing a specification nobody needs.

Because skipping refinement is a judgement call that can be wrong, the Story
workflow gains a retreat: an idea that turns out to be larger or more ambiguous
than a small direct change can move from `Implement` back to `Grill` and rejoin
the pipeline it skipped.

## User Stories

1. As a Ticketry user, I want a Run now action on an idea, so that I can send a
   small change straight to implementation without walking it through
   refinement.
2. As a Ticketry user, I want Run now to appear beside the existing run actions
   in the work item's Details surface, so that every way of starting agent work
   lives in one place.
3. As a Ticketry user, I want one click to both move the Story and start the
   agent, so that I do not have to change the state and then remember to launch.
4. As a Ticketry user, I want the idea to remain the same work item after Run
   now, so that its ticket number, description, and history follow the work.
5. As a Ticketry user, I want a Run now Story to reach `Review` the way any
   implemented Story does, so that skipping refinement does not create a
   second completion path.
6. As a Ticketry user, I want Run now offered only while the workflow permits a
   human move from the current state directly to `Implement`, so that the button
   never promises a move the transition gate would refuse.
7. As a workflow administrator, I want removing that transition to remove the
   action, so that the workflow remains the single switch and no separate
   setting can contradict it.
8. As a workflow administrator, I want no independent Run Now capability flag,
   checkbox, or mutation, so that I cannot create an unsupported combination of
   settings.
9. As a Ticketry user, I want Run now to leave items in `Tickets` untouched, so
   that the existing human kickoff after ticketing behaves exactly as before.
10. As a Ticketry user, I want a keyboard binding for Run now, so that I can fire
    it without reaching for the pointer.
11. As a keyboard user, I want that binding to do nothing when the selected item
    is not an eligible idea, so that a stray keypress cannot start unintended
    work.
12. As a keyboard or assistive-technology user, I want Run now to expose a
    distinct accessible name and a pending state, so that I can invoke it and
    know its request is in flight.
13. As a Ticketry user, I want a double-click or repeated activation to be
    guarded by the control's own in-flight state, so that one intent cannot
    produce two runs.
14. As a Ticketry user, I want the provider resolved from the destination state's
    launch binding, so that Run now stays one click and does not ask me a
    question I have already answered in workflow settings.
15. As a Ticketry user, I want the destination state's model, reasoning, and
    required-skill policy applied, so that a Run Now run is configured exactly
    like any other run entering `Implement`.
16. As a Ticketry user, I want the run's prompt to come from the destination
    state's binding rather than from the caller, so that what an implementing
    agent is told does not depend on which surface started it.
17. As a Ticketry user, I want the workspace to switch to that work item's
    terminal after a successful Run now, so that I land in the running agent
    rather than watching the row vanish from Ideas.
18. As a Ticketry user, I want Run now refused when the idea already has a live
    agent run or terminal, so that two agents never contend for one checkout.
19. As a Ticketry user, I want that refusal to leave the Story in `Ideas`, so
    that a refused request changes nothing at all.
20. As a Ticketry user, I want the refusal explained in terms I can act on, so
    that I know an agent is already running rather than seeing a bare error.
21. As a Ticketry user, I want missing prerequisites detected before the state
    moves, so that a misconfigured module does not strand my idea in
    `Implement`.
22. As a Ticketry user, I want an unresolvable module ancestry, an unselected
    profile, a missing launch binding, or an unavailable required skill to
    refuse the request with the existing structured error, so that Run Now
    reports failures the same way every other launch does.
23. As a Ticketry user, I want a launch failure that can only be discovered at
    launch time to be reported honestly, so that I am never told work started
    when it did not.
24. As a Ticketry user, I want the Story to remain in `Implement` after such a
    late failure and to be retryable with the existing run action, so that
    recovery uses machinery I already understand.
25. As a Ticketry user, I want no automatic rollback of the state move, so that
    Ticketry never writes a workflow move the transition gate would not permit.
26. As a Ticketry user, I want an idea that proves larger than expected to be
    moved back to `Grill`, so that misjudged work rejoins refinement instead of
    being force-implemented or cancelled.
27. As a Ticketry user, I want that retreat to keep the original work item, so
    that its number, description, and any attached conversation survive the
    change of plan.
28. As an implementing agent, I want the destination prompt to tell me to stop
    and retreat when the work is larger or more ambiguous than a small direct
    change, so that I do not invent product decisions nobody made.
29. As an orchestrating agent, I want a Run Now tool, so that I can start trivial
    work without composing a state move and a launch myself.
30. As an Ideas triage agent, I want a third routing branch for small,
    unambiguous, self-contained work, so that trivial ideas stop consuming a
    refinement pipeline they do not need.
31. As an Ideas triage agent, I want that branch to use the composed capability
    rather than a bare state move, so that I cannot leave an idea in `Implement`
    with nothing running.
32. As a workflow administrator, I want the transition gate to evaluate the
    caller's real origin, so that no surface can quietly outrank the workflow's
    own permissions.
33. As a workflow administrator, I want the human kickoff from `Tickets` to
    remain closed to agents, so that a finished specification and its generated
    tickets still get a person's look before agents act on them.
34. As a maintainer, I want the reasoning behind two differently-gated doors into
    `Implement` written down, so that a future reader reads it as a decision
    rather than as drift.
35. As a maintainer, I want Studio, the MCP tool, and any future surface to share
    one implementation of the capability, so that the ordering and refusal rules
    cannot diverge between callers.
36. As a maintainer, I want Run Now to arm no graph run and write no launch fact,
    so that it stays outside subtree execution and cannot confuse a campaign.
37. As a Ticketry user starting a fresh project, I want both workflow edges
    seeded, so that the feature works without hand-configuring my workflow.
38. As a Ticketry user with an existing project, I want my hand-edited prompts
    left alone, so that an upgrade never silently rewrites text I authored.
39. As a Ticketry user, I want Run Now to remain distinct from an Instant run, so
    that "tracked work item, skips refinement" and "taskless scratch change" stay
    two clearly different things.
40. As an API client, I want the capability expressed as one request that reports
    the resulting state and the launched run, so that I do not have to infer the
    outcome from two separate calls.

## Implementation Decisions

* Add one **Run Now** capability owned by the execution app, alongside the
  existing direct task launch and separate from subtree execution. It arms no
  root, writes no launch fact, and participates in no campaign.
* Expose it as one endpoint on the execution HTTP surface and one MCP tool
  taking a work item's identifier or key. Both call the same service function;
  neither reimplements any part of the policy.
* The capability performs, in this order:
  1. Refuse if the target already has a live agent run or terminal.
  2. Resolve module ancestry, the selected profile, the destination launch
     binding, and its required skills; refuse if any is unavailable.
  3. Move the work item to `Implement` through the ordinary transition gate,
     supplying the caller's real origin.
  4. Launch a task-scoped run using the configuration already resolved for the
     committed destination.
* The move must precede the launch because a run's prompt and configuration come
  from the item's current-state launch binding. Launching first would deliver the
  `Ideas` triage prompt.
* Pass the pre-resolved configuration into the launch rather than re-resolving
  it, mirroring how state-entry automation pins destination policy for a
  committed transition. This also removes any window in which the binding could
  be read from the wrong state.
* Preserve the launch contract: no caller-supplied prompt reaches a task-scoped
  run. Everything an implementing agent is told comes from the destination
  state's binding.
* Reuse the existing launch failure vocabulary unchanged — unknown target,
  missing module ancestry, no selected profile, unavailable required skill,
  launch unavailable — so callers map one set of errors.
* Distinguish two failure classes in the response contract. A refusal before the
  move reports that nothing changed. A failure after the move reports the
  committed state together with the absence of a run, so no caller can read a
  partial outcome as success.
* Do not roll the state move back on a late launch failure. The Story workflow
  has no edge from `Implement` back to `Ideas`, and writing one behind the
  transition gate would contradict the gate's authority. Recovery is the existing
  direct run action.
* Perform no liveness probe of the terminal layer before moving. A probe is a
  race, not a guarantee, and the late-failure outcome already reports the
  situation clearly.
* Studio renders a `Run now` control in the work item Details status row beside
  the existing run actions, presented by the work-item feature rather than shared
  plumbing. It owns its own in-flight guard and pending label.
* Studio's eligibility rule: the item's current state is `Ideas` and its issue
  type permits a human transition from that state directly to `Implement`. No new
  capability field, workflow mutation, or settings control is introduced. A stale
  capability refresh that removes the transition removes the control.
* Register one global keymap binding for the action through the existing central
  keymap registry, with a shortcuts-panel label. The binding resolves against the
  selected work item and is inert when that item is not eligible.
* On success Studio activates the target work item's terminal, matching the
  existing launch flows that open a terminal, rather than the direct run action
  which stays put. The click already relocates the row out of `Ideas`, so the
  terminal is what makes the outcome visible.
* Extend the Story workflow with two transitions, seeded in the reviewed defaults
  artifact and applied to existing projects by migration:
  * `Ideas → Implement`, permitted for both humans and agents. This amends the
    staged human-only migration rather than adding a second one.
  * `Implement → Grill`, permitted for agents, providing the retreat for an idea
    that proves too large.
* Leave `Tickets → Implement` human-only. The resulting asymmetry — the less
  examined work passing the looser gate — is deliberate and is recorded in an
  architecture decision record amending the decision that split refinement into
  three launchable stages.
* Bump the issue type's workflow revision when either transition is added, as the
  existing transition migrations do.
* Change two seeded prompts in the reviewed defaults artifact, for new projects
  only:
  * The `Story` prompt for `Implement` gains a bail-out clause: with no
    Implementation children, work that is larger or more ambiguous than a small
    direct change must stop and move the Story to `Grill` rather than guess.
  * The `Story` prompt for `Ideas` gains a third triage branch: small,
    unambiguous, self-contained work uses the Run Now tool; missing decisions
    still route to `Grill`; sufficient context still routes to `Spec`. The branch
    must use the composed tool, never a bare state move.
* Ship **no prompt-rewrite migration**. Launch bindings are seeded on first
  creation only, and existing projects carry prompts their owners may have
  edited. Updating an existing project is a deliberate edit in the state
  configuration panel, not an upgrade side effect.
* Regenerate the typed client after the endpoint is added. The
  Tauri/webview boundary is unchanged; this remains a Studio-to-supervised-backend
  interaction.
* Respect the repository's boundaries: the composed capability and its launch
  sequencing stay in the execution app, transition authority and prompt storage
  stay in worktracker, agent and session liveness stay with runs and terminals,
  and the control stays in Studio's work-item feature.

## Testing Decisions

A good test here observes what a caller can see: whether the work item moved,
whether a run started, which refusal came back, and which control a user can
invoke. Tests must not assert the internal ordering of private helpers, the
shape of component-local state, or the names of intermediate functions — only
the externally visible consequences of the four ordered steps.

* Use the **execution app's HTTP API tests** as the single backend seam for the
  whole contract. This is the same seam that already covers the direct task
  launch, and it is high enough that the ordering rule is observable as one
  behaviour rather than split across layers.
* At that seam, cover: a successful request reporting the committed state and the
  launched run; a refusal while a live agent run or terminal exists, asserting
  the state is unchanged; each pre-flight refusal — unresolvable module ancestry,
  unselected profile, missing launch binding, unavailable required skill —
  asserting the state is unchanged; a launch failure after the move, asserting
  the committed state and the absence of a run are both reported; and an
  ineligible source state refused by the transition gate.
* Assert that the caller's origin reaches the gate, by covering both a permitted
  agent-origin request and a request the gate refuses, so no surface can be shown
  to bypass workflow permissions.
* Assert that a successful request arms no graph run and records no launch fact,
  so Run Now cannot be mistaken for subtree execution.
* Use the **MCP tool tests** that already cover the direct launch tool as the
  seam for tool exposure. Cover only that the tool reaches the same service, that
  it accepts an identifier or a key, and that a refusal is returned structurally
  rather than raised. Do not restate the policy assertions there.
* Extend the **existing workflow migration test** for the staged
  `Ideas → Implement` transition so it asserts the agent-permitted value, and
  cover the new `Implement → Grill` transition the same way — including
  idempotency on re-run, projects missing one of the states, and the workflow
  revision bump.
* Extend the **reviewed defaults validation and seeding tests** so the two new
  transitions and the two changed prompts are seeded into a fresh project, and
  assert that seeding an existing project leaves stored prompts untouched.
* Add one **new numbered Studio acceptance case** in the mounted-application
  seam, modeled on the existing subtree-run acceptance case and the task-agent
  launch acceptance family with its shared harness. Cover: the control appears
  for an eligible idea and not otherwise; a click issues the request, and on
  success the workspace switches to that item's terminal; the control exposes a
  pending state and cannot be double-submitted; a refusal is surfaced to the user
  without claiming work started; the keyboard binding invokes the same path and
  is inert for an ineligible selection; and the control disappears after a
  capability refresh removes the transition.
* Keep the numbered overhaul gate current and run the mandated Studio overhaul
  suite before handing the change off, together with the affected backend
  execution, worktracker workflow, and generated-client checks, plus Studio unit
  tests and typecheck.

## Out of Scope

* A row-level Run Now action on Stories pane rows, and any hover affordance in
  the work item tree.
* A capture-and-run control beside the idea entry surface.
* Choosing a provider, model, or reasoning level at click time, by modal or by
  modifier-click.
* Any change to the parallel or serial subtree run actions, the direct task
  launch action, or the graph-run contract.
* Rolling back the workflow move when a launch fails, or introducing any edge
  from `Implement` back to `Ideas`.
* Opening `Tickets → Implement` to agents, or otherwise changing the human
  kickoff after ticketing.
* Adding a third origin value or otherwise changing the transition permission
  model.
* Migrating stored launch prompts in existing projects.
* Changing the Instant Change flow, the Plan flow, scratch workspaces, or the
  taskless run vocabulary.
* Bulk Run Now across several ideas at once.
* Changing dependency storage, archive semantics, subtree reset, durable terminal
  sessions, or the native terminal renderer.

## Further Notes

* **Run Now** is the composed capability: move one work item from `Ideas` to
  `Implement` through the ordinary gate, then launch a task-scoped run for the
  committed destination. It is deliberately distinct from an **Instant Change**,
  which is taskless, scratch-scoped, and prompted by the caller. Conflating the
  two in naming or in prompts would blur the one distinction the feature exists
  to draw.
* The move and the launch are one capability specifically so that no caller can
  produce an idea sitting in `Implement` with nothing running. `Implement` arms
  no state-entry automation, so a bare state move would strand the work
  silently.
* Capturing an idea does not start an agent: state-entry automation fires only on
  a transition into a state, and a newly created work item has no prior state.
  The `Ideas` prompt therefore runs when something moves back into `Ideas` or
  when a user launches a run there — which is where the new triage branch takes
  effect.
* The retreat edge is agent-permitted rather than human-only because the agent
  doing the work is the party best placed to notice that the change is bigger
  than advertised. The user retains the same move through the state picker.
* The two prompt changes are data, not code paths. Their wording will drift with
  use, and that is expected; the specification fixes the branches those prompts
  must express, not their phrasing.
