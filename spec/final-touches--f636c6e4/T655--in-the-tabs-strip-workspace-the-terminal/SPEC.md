# CODING-655 — Make terminal tabs identify the run, not the ticket

Status: Spec complete
Story: WorkTracker #655 (`373a24ce-8ffa-4649-860b-e645191b8d0d`)
Date: 2026-08-16
Related design: [The tab tells you who is working, not which ticket](design.md)

## Problem Statement

Terminal tabs in a task workspace currently repeat the work-item identifier and
provider, for example `T-655 · claude`. The work-item identifier is already
obvious from the workspace around the strip, so repeating it spends the tab's
most valuable space on information that does not help distinguish one terminal
conversation from another.

What matters while scanning several terminals is which phase of the work each
conversation belongs to and which provider is running it. A conversation begun
while a Story was in Grill remains the Grill conversation even after the Story
moves to Spec. Showing the Story's current state would make every tab change at
once and would erase exactly the historical distinction the strip needs to
communicate.

Provider, workflow phase, model, lifecycle, selection, and keyboard focus are
separate facts. The current neutral tab treatment does not give provider a
strong visual identity, while reusing lifecycle or focus colors for provider
would make those independent signals ambiguous.

## Solution

Replace the ticket-based terminal label with the workflow state captured when
the run launches. A task-bound run started in Grill reads `Grill`; one started
in Spec reads `Spec`. That value is a write-once launch snapshot and does not
change when the Story later moves through its workflow.

Use tab color to identify the provider. Live Claude, Codex, Gemini, and agy
terminal tabs receive distinct, accessible provider colors. The selected tab is
filled with its provider color and uses near-black text; unselected tabs use the
pane background and the provider color as text. This inversion makes selection
obvious without consuming the focus accent or lifecycle palette.

The model is not encoded as another color or printed in the compact label.
Hover text exposes provider, resolved model, and launch state together. This
keeps the strip compact and prevents the palette from expanding whenever model
configuration changes.

Ended or unavailable runs use neutral grey instead of a provider color, making
color itself mean that a run remains live. Existing lifecycle badges stay in
place as a separate signal. If multiple live runs in one workspace share the
same provider and launch state, their labels gain stable launch-order ordinals,
such as `Grill 1` and `Grill 2`; a unique run has no ordinal.

Scratch runs continue to read `plan` and `instant`. Historical runs whose
launch state was not recorded show no invented workflow state. The task
workspace's dormant terminal history chips use the same label and color rules
as the active tab strip.

## User Stories

1. As a Ticketry user, I want a terminal tab to name the workflow phase in
   which its run began, so that I can tell which conversation belongs to which
   stage of the work.
2. As a Ticketry user, I want a Grill run to keep reading `Grill` after its
   Story moves to Spec, so that historical conversations do not lose their
   meaning.
3. As a Ticketry user, I want terminal tabs to stop repeating the ticket
   identifier, so that the limited strip space carries information I need.
4. As a Ticketry user, I want terminal tabs to stop using the ticket title as
   their identity, so that long or similar Story names do not obscure the run.
5. As a Ticketry user, I want color to identify the provider, so that I can
   recognize Claude, Codex, Gemini, and agy terminals at a glance.
6. As a Claude user, I want Claude runs shown in Anthropic orange, so that the
   tab uses the provider identity I already recognize.
7. As a Codex user, I want Codex runs shown in a light neutral white, so that
   they are visually distinct from Claude and the other providers.
8. As a Gemini user, I want Gemini runs shown in a distinct accessible blue,
   so that they remain identifiable without a text prefix.
9. As an agy user, I want agy runs shown in a distinct accessible purple, so
   that they do not collide with provider or lifecycle colors.
10. As a Ticketry user, I want the selected terminal tab to be filled and the
    other terminal tabs to be outlined by color, so that selection is obvious
    even when several runs share a provider.
11. As a keyboard user, I want keyboard highlight to remain independent from
    selected-tab styling, so that I can distinguish navigation focus from the
    active terminal.
12. As a Ticketry user, I want lifecycle badges to retain their own colors and
    meanings, so that provider identity does not masquerade as run status.
13. As a Ticketry user, I want an exited, lost, or errored terminal to become
    neutral grey, so that provider color consistently means the run is live.
14. As a Ticketry user, I want a live run to retain its provider color across
    lifecycle changes, so that working, waiting, and stalled presentations do
    not change provider identity.
15. As a Ticketry user, I want two live runs with the same provider and launch
    state to gain ordinals, so that I can distinguish otherwise identical
    tabs.
16. As a Ticketry user, I want those ordinals assigned in launch order, so that
    their identities remain predictable.
17. As a Ticketry user, I want a lone provider/state run to omit an unnecessary
    numeral, so that the common label stays short.
18. As a Ticketry user, I want duplicate detection limited to live runs, so
    that historical collisions do not make current labels noisy.
19. As a Ticketry user, I want a scratch planning run to keep the label `plan`,
    so that taskless runs remain understandable without a workflow state.
20. As a Ticketry user, I want a scratch instant run to keep the label
    `instant`, so that its taskless launch mode remains visible.
21. As a Ticketry user, I want a historical run with no captured launch state
    to show no fabricated state, so that the interface does not present a guess
    as fact.
22. As a Ticketry user, I want a historical live run to retain its provider
    color even when its launch state is unknown, so that the facts Ticketry does
    know remain useful.
23. As a Ticketry user, I want hover text to show provider, resolved model, and
    launch state, so that I can inspect precise launch configuration without
    widening every tab.
24. As a Ticketry user, I want dormant history chips to use the same labels and
    provider colors as terminal tabs, so that one workspace does not use two
    vocabularies for the same runs.
25. As a Ticketry user, I want terminal close controls and accessible names to
    use the new run label, so that assistive text does not continue repeating
    the removed ticket identity.
26. As a user with low vision, I want provider text and fills to meet readable
    contrast against the pane and chosen ink, so that color encoding remains
    legible in selected and unselected states.
27. As a maintainer, I want the captured launch state and resolved model to be
    durable run facts, so that reload and reconnect reconstruct the same tab.
28. As a maintainer, I want the status snapshot and live status feed to expose
    the same launch metadata, so that a tab does not change meaning depending
    on how Studio learned about the run.
29. As a maintainer, I want one shared terminal presentation rule for active
    tabs and dormant chips, so that their terminology and colors cannot drift.
30. As a maintainer, I want existing runs to remain readable after the schema
    change, so that deployment does not require an inaccurate backfill.

## Implementation Decisions

### Durable launch facts

* Persist the workflow state's display name and the resolved model on the
  durable agent run at launch. Both fields are nullable for compatibility and
  are write-once snapshots, not live references to mutable configuration.
* Capture the state name from the task at the shared durable launch boundary so
  manual and automated task launches follow the same rule. Capture the model
  actually selected by launch configuration, including provider or model
  overrides that apply to that launch.
* Do not derive launch state from the task at render time. Do not rely on an
  automation-attempt record, because manual task launches do not have one.
* Do not store a workflow-state foreign key for this purpose. A later state
  rename or deletion must not rewrite what the run was launched as.
* Do not backfill pre-existing runs. Null launch state means "not recorded" and
  remains distinct from every real workflow state.

### Public run projection

* Add the nullable launch-state and model snapshots to the canonical run record
  emitted by both the authoritative status snapshot and live status updates.
  Regenerate the typed SDK surfaces from that contract.
* Preserve run identity, ownership, lifecycle, output-activity, runtime, and
  transport semantics. Launch metadata is descriptive and does not participate
  in lifecycle reduction or terminal reconciliation.
* Restoration, reconnect, and dormant-history loading must retain the same
  launch metadata; no client path substitutes the Story's current state.

### Labels and duplicate disambiguation

* A task-bound run's base label is its captured launch-state name. Remove the
  ticket identifier, ticket title, and provider slug from the compact visible
  label.
* Scratch Plan and Instant runs retain the lowercase labels `plan` and
  `instant`. Lowercase distinguishes a launch mode from a workflow-state name.
* A run without a captured launch state has an empty state word rather than a
  guessed fallback. Provider identity remains available through styling and
  hover text.
* Detect collisions by the pair `(provider, launch state)` among live terminal
  tabs in the same task workspace. When a pair occurs more than once, append
  ordinals to every member in ascending launch order. Do not show ordinals for
  unique pairs or because an ended historical run shares the pair.
* Centralize the label and collision presentation so the active tab strip and
  dormant history chips use the same vocabulary.

### Provider and terminal presentation

* Use this fixed initial provider palette with near-black ink:
  * Claude: `#D97757`.
  * Codex: `#E8E8E8`.
  * Gemini: `#4285F4`.
  * agy: `#BB9AF7`.
* Treat these as named provider presentation tokens rather than scattering
  literal colors through tab and chip components.
* For a selected live terminal, fill the tab with the provider color and use
  near-black text. For an unselected live terminal, use the pane background and
  provider-colored text. Selection changes only this inversion.
* Preserve the existing keyboard-highlight ring as the focus signal. Provider
  styling does not reuse the focus accent.
* Preserve lifecycle badges and their existing palette. Provider styling does
  not replace, recolor, or derive those badges.
* Present exited, lost, and errored runs with neutral grey `#7a8599` in both
  selected and unselected variants. Do not combine provider hue with an opacity
  fade for ended runs.
* Keep the model out of the compact label and color palette. The hover title is
  composed from the known provider, resolved model, and launch state, omitting
  unknown values without inventing placeholders.
* Apply the same provider, selection/liveness, label, and hover rules to dormant
  terminal history chips where those states are applicable.
* Accessible names for terminal selection and close actions use the final
  visible run label plus sufficient terminal context; they no longer expose the
  removed ticket-based label.

### Structure and compatibility

* Keep durable launch metadata, public run projection, label computation,
  provider presentation, and tab/chip rendering as separate focused concerns.
  Do not enlarge a shell component or status store into the owner of all five.
* Preserve the narrow webview boundary and the existing native-terminal/browser
  fallback. This feature changes metadata presentation, not renderer ownership
  or terminal transport.
* Plain panel shell tabs are a different domain surface: they carry no provider,
  workflow state, or model and are not changed by this specification.

## Testing Decisions

A good test observes durable launch facts, public run projections, or mounted
workspace behavior. It should assert what a user sees after launch, transition,
selection, exit, reload, and collision. It should not assert private component
state, CSS implementation mechanics, ORM call order, or the exact helper used
to calculate labels.

Two existing seams are sufficient; no new test seam is required.

### Studio overhaul acceptance seam

The numbered Studio acceptance suite is the highest existing seam for this
user-visible behavior. Extend its terminal workspace coverage and the overhaul
matrix with cases that prove:

* A run launched in Grill reads `Grill` before and after the Story moves to
  Spec, while a later Spec run reads `Spec`.
* No terminal tab or dormant history chip repeats the ticket identifier or
  ticket title.
* Claude, Codex, Gemini, and agy each use their specified provider token with
  readable near-black/pane contrast.
* Exactly the selected live terminal uses provider fill; selecting another tab
  moves the fill while preserving the keyboard-highlight and lifecycle signals.
* Exited, lost, and errored terminals use neutral grey with no provider color.
* Duplicate live provider/state pairs receive launch-order ordinals and lose
  unnecessary ordinals when no live collision remains.
* Scratch Plan and Instant labels remain unchanged, while a historical run with
  null launch state displays no invented state and retains known provider
  presentation.
* Hover text presents provider, resolved model, and launch state, omitting
  facts that were not recorded.
* Active tabs and dormant history chips render the same label and provider
  treatment for the same run.
* Reload/reconnect restores launch state, model, provider styling, ordinals, and
  liveness treatment from the authoritative run records.

Prior art is the existing overhaul terminal navigation and restoration
coverage, which already mounts task workspaces, restores session metadata,
switches terminal tabs, closes runs, and verifies accessible tab behavior.

### Backend run/terminal application seam

Extend the existing durable-launch, run-projection, status API, and status-feed
tests for behavior the mounted Studio suite receives through fakes:

* Every task launch path snapshots the launch state's display name and the
  actually resolved model when it creates the durable run.
* The snapshot remains unchanged after the work item transitions or its launch
  configuration changes.
* Manual and automated launches produce the same snapshot semantics.
* Existing/null rows remain valid and are projected as null without fallback to
  current task state.
* Authoritative snapshots and live frames serialize identical launch-state and
  model values, and SDK contract tests accept both populated and null records.
* Resume and reconciliation preserve the original launch snapshots and do not
  overwrite them.

Prior art is the application-service coverage around durable launch
compensation and launch-configuration resolution, plus the status snapshot,
stream, and wire-contract suites. Keep database assertions at this service
boundary rather than duplicating them in presentation tests.

Before implementation handoff, keep the numbered overhaul acceptance document
current and run `npm run test:overhaul --workspace @worktracker/studio`, the
affected backend runs/terminals tests, Studio contract/type checks, and SDK
generation consistency checks.

## Out of Scope

* Creating Implementation tickets, child work items, dependency edges, or an
  implementation campaign during this Spec stage.
* Changing lifecycle badge meanings, lifecycle derivation, stalled-output
  behavior, or the lifecycle color palette.
* Changing terminal runtime ownership, tmux durability, viewer attachment,
  native rendering, browser fallback, or terminal transport.
* Applying provider/workflow metadata to terminal-panel shell tabs, which are
  not agent runs.
* Backfilling launch state or model for runs created before the new snapshots
  existed.
* Encoding model identity as a color, adding model names to compact tab labels,
  or creating a shade per model.
* Making provider colors user-configurable or deriving them from the provider
  catalog in this iteration.
* Redesigning document tabs, Details, module tabs, or workspace layout.
* Changing terminal close, resume, or dormant-history retention semantics.

## Further Notes

The provider palette was selected to remain distinct from the existing
lifecycle palette. Near-black ink gives the specified colors readable contrast
in the selected variant, while the same provider colors remain readable as text
against the near-black pane in the unselected variant. Because contrast is
symmetric, selection inversion does not require a second provider palette.

The fixed launch-state snapshot is an intentional historical fact. A workflow
state renamed after a run launches does not rename that run's tab; the old name
is what the phase was called when the conversation began. This decision is
recorded in the terminals ADR for launch-state snapshots and should remain
explicit in future migrations or cleanup work.

The key semantic rule is: **the label tells when the conversation began, the
color tells who is running it, the lifecycle badge tells what it is doing, the
fill tells which tab is selected, and the focus ring tells where keyboard
navigation is.** Keeping those axes separate is the feature's primary design
constraint.
