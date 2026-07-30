# Add Matt-style workflow stages and state icons

**Work item:** CODING-60 (Story) — `c77d2a2f-95b4-43bd-ad7d-9e71274a068d`
**Module:** `final-build` — `c54de42c-02fc-4a57-8947-a65a312cebd5`

## Problem Statement

A person refining a Story in Ticketry today launches one agent at one state
called `Refinement`, and that single agent is asked to do three unrelated jobs in
one session: interview them until the requirements are sharp, write the
specification, and cut the dependency-ordered implementation tickets.

They cannot see between those jobs. If the interview went badly — the agent
misread the ask, or stopped grilling too early — the same session has already
written a specification on top of that misunderstanding and cut a dozen tickets
from it before the person has any surface at which to look. The first honest
signal that refinement went wrong is a ticket list that is wrong, at which point
the cheapest recovery is to throw all of it away.

The task tree gives them nothing to read the pipeline by either. Every state
header is the same undifferentiated row — a Unicode triangle and a bold word —
so the shape of the workflow has to be held in the person's head rather than
seen. `Idea`, `Refinement`, and `Ready` also do not describe what happens in
them; a person has to learn that `Refinement` means grill-then-spec-then-tickets
and that `Ready` means nothing happens at all.

Underneath, the vocabulary those stages are named in is written down three times
— in the backend state constants, in the finalization validator, and in the
reviewed defaults artifact — plus a fourth copy of the per-stage skill
requirements. Renaming a stage or inserting one means four coordinated edits, and
a missed copy does not fail at review time; it fails later, when a project is
created.

## Solution

Refinement becomes three named stages a person can see and stop at, and the task
tree becomes readable at a glance.

A Story now moves through five working stages — **Grill**, **Spec**,
**Tickets**, **Implement**, **Review** — before **Done**, with **Cancelled** as
the shared off-ramp. Each stage owns one deliverable and at most one pinned
upstream skill, so a person launching a stage knows exactly what that run will
produce.

The refinement chain drives itself but stops where the person's judgement is
required. Grilling is interactive, so that stage blocks on them anyway; when it
completes, the Story advances and the specification stage starts on its own, and
when that completes the ticket-cutting stage starts on its own. The chain then
halts at `Tickets` and waits. Entering implementation is the person's call — they
kick it off, and only then does anything under the Story run.

Every state header in the task tree shows a stage icon between the collapse
control and the state name, in the same inline-SVG idiom as the rest of the
application's icons, inheriting the stage's own colour.

`Ready` disappears. It was a queue that existed to hold work that nothing was
going to run, and the thing that actually gates running is the person's kickoff.
Review findings are created directly in the implementation stage and are inert
for the same structural reason — nothing runs until kickoff — so the queue, and
the bulk state move that used to drain it, are both removed rather than renamed.

The vocabulary is declared once, in the reviewed defaults artifact, and the
backend constants, the finalization validator, and the default skill
requirements all derive from it.

Existing projects are migrated in place, so the change is visible where the
application is actually used, and hand-edited prompts survive the migration.

## User Stories

1. As a maintainer refining a Story, I want the interview, the specification, and
   the ticket-cutting to be three separate stages, so that I can inspect the
   result of each before the next one builds on it.
2. As a maintainer, I want a Story I have just created to start in a stage named
   for what happens there, so that I do not have to learn that `Idea` means
   "an agent will try to make sense of this".
3. As a maintainer, I want the grilling stage to launch only the grilling skill,
   so that the agent interviews me instead of racing ahead to write a spec.
4. As a maintainer, I want the specification stage to start automatically once
   grilling completes, so that I am not relaunching an agent by hand between two
   stages that always follow each other.
5. As a maintainer, I want the ticket-cutting stage to start automatically once
   the specification is written, for the same reason.
6. As a maintainer, I want the chain to stop at the ticket stage and wait for me,
   so that no implementation work begins until I have read the tickets.
7. As a maintainer, I want moving a Story into implementation to be a move only I
   can make, so that no chain of automation can start implementation on its own.
8. As a maintainer, I want each stage's launch prompt to describe only that
   stage's job, so that an agent launched there is not carrying instructions for
   two other stages.
9. As a maintainer looking at the task tree, I want each state header to carry an
   icon, so that I can find a stage by shape rather than by reading every word.
10. As a maintainer, I want the stage icon to sit between the collapse control and
    the state name, so that the collapse affordance stays where my hand already
    expects it.
11. As a maintainer, I want stage icons to take their stage's colour, so that the
    icon and the state read as one thing rather than two.
12. As a maintainer on a high-density display, I want stage icons to stay crisp at
    any scale, so that the tree does not look degraded next to the rest of the
    application.
13. As a maintainer, I want the terminal states to carry icons too, so that the
    left edge of the header column is uniform instead of ragged.
14. As a maintainer whose project already exists, I want my project's stages
    renamed in place, so that the new workflow applies to the work I already have
    rather than only to projects I create in future.
15. As a maintainer whose project already exists, I want my work items to stay in
    the stage they were in across the migration, so that nothing is silently
    rescheduled.
16. As a maintainer who has hand-edited a launch prompt, I want that edit to
    survive the migration, so that the upgrade does not discard my configuration.
17. As a maintainer who has not edited a launch prompt, I want the new stage
    prompt, so that I get the improved instructions without doing anything.
18. As a maintainer creating a fresh project, I want it materialized with the new
    stages, graphs, prompts, icons, and skill requirements in one step, so that a
    new project and a migrated project behave identically.
19. As a maintainer reviewing defaults in the workbench, I want the workflow
    graph I see to be the graph that is actually seeded, so that finalizing means
    what it appears to mean.
20. As a maintainer adding or renaming a stage in future, I want to declare it in
    one place, so that I cannot ship a half-renamed vocabulary.
21. As a maintainer, I want the finalization step to still reject a malformed or
    disconnected workflow graph, so that removing the hardcoded name list does not
    remove the safety net.
22. As an agent launched at a stage, I want the pinned upstream skill for that
    stage to be verified present before my session starts, so that I fail loudly
    rather than improvising without the skill.
23. As an agent reviewing a Story, I want to file a finding as an ordinary
    implementation child, so that the fix rejoins the normal execution machinery.
24. As a maintainer, I want a filed finding to run nothing until I kick off
    implementation, so that reviewing a Story never starts work behind my back.
25. As a maintainer, I want the classic workflow definition kept in the tree, so
    that I can read what the previous vocabulary was without recovering it from
    version history.
26. As a maintainer running a PathFind item, I want it to keep behaving exactly as
    it did, so that the stage rename does not quietly redesign a type I did not
    ask to change.
27. As a maintainer, I want the glossary and decision records to describe the new
    stages, so that the next person reading the domain model is not learning a
    vocabulary the code no longer uses.

## Implementation Decisions

### Stage vocabulary

The canonical state vocabulary becomes seven states, ordered: **Grill**
(`backlog`), **Spec** (`unstarted`), **Tickets** (`unstarted`), **Implement**
(`started`), **Review** (`started`), **Done** (`completed`), **Cancelled**
(`cancelled`). `Grill` inherits the display colour of the state it replaces, as
does `Spec`; `Tickets` takes a new colour in the `unstarted` group.

`Idea` is renamed to `Grill`. `Refinement` is renamed to `Spec`. `Tickets` is
new. `Ready` is retired entirely.

`Ready` is removed rather than kept as a hidden or type-scoped state. It existed
to hold work that nothing was going to run, and the actual gate on running is a
person's kickoff, so the state carried no behaviour that the kickoff does not
already carry.

### Per-type workflow graphs

```
Story:           Grill → Spec → Tickets → Implement → Review → Done
Implementation:  Implement → Review → Done
PathFind:        Spec → Done
```

Every type additionally reaches `Cancelled` from each of its non-terminal
states. `Review → Implement` is retained for Story and Implementation as the
rework edge.

`Story` starts at `Grill`. `Implementation` continues to start at `Implement`.
`PathFind` starts at `Spec`, inheriting the rename with no behavioural change.

`Tickets → Implement` is a **human-only** transition: agent-origin writes to it
are rejected at enforcement, and force does not rescue them. This is the single
mechanism that stops the refinement chain from running into implementation.

### The refinement chain and launch policy

Launch bindings for the three refinement stages carry one pinned upstream skill
each and state-entry auto-start as follows:

| Stage | Required skills | State-entry auto-start |
| --- | --- | --- |
| Grill | `grill-with-docs` | off |
| Spec | `to-spec` | on |
| Tickets | `to-tickets` | on |

Auto-start is off at `Grill` because a Story arrives there on creation and
grilling must not begin before a person is present. It is on at `Spec` and
`Tickets` so the chain advances without a relaunch. It is off everywhere else.

Each stage's prompt is scoped to that stage's single deliverable and requests
only its own outgoing transition. The stage prompts replace the current
combined refinement prompt, which is split three ways rather than duplicated.

Story retains its subtree-run capability so implementation kickoff can start a
dependency subtree run from the implementation stage.

### The artifact as single vocabulary source

The reviewed defaults artifact becomes the sole declaration of the state
vocabulary, the task issue types, the per-type workflow graphs, and the default
per-stage skill requirements. It gains a `requiredSkills` key mapping stage name
to an ordered list of pinned skill identifiers.

The backend state constants, the finalization validator's canonical state and
issue-type lists, and the default skill requirements are all derived from the
artifact instead of restating it. The artifact is already tracked, already read
at import by the seed modules, and already bundled into the frozen sidecar, so it
is a boot-time source rather than a build input.

The validator consequently stops asserting a hardcoded list of state names. It
continues to enforce schema version, the top-level key set, the timestamp
format, non-empty guidance, well-formed state entries with valid groups, a
non-empty prompt for every issue-type/stage pair, and every graph invariant —
start-state membership, two-element edges, no duplicate or self edges, no
outgoing edges from terminal states, and connectivity to and from the start
state. It additionally validates that every `requiredSkills` identifier is one
the pinned snapshot provides. This is a deliberate trade: the "nobody renamed a
state unintentionally" tripwire moves from the validator to the migration and
seeding tests. Recorded as an ADR.

### Migration of existing projects

Seeding is additive and never re-seeds an existing project, so the artifact
change alone would leave existing projects on the old vocabulary. A data
migration therefore renames the state rows in place:

- rename `Idea` → `Grill`, rename `Refinement` → `Spec`
- insert `Tickets` in the `unstarted` group at its canonical display position
- move any work item still in `Ready` to `Implement`, then delete the `Ready` row
- rebuild the per-type transition sets and start states for Story,
  Implementation, and PathFind
- create the launch bindings for the new stage, and set auto-start and required
  skills per the table above

Renaming rather than recreating means work items keep their state identity and
nothing needs remapping — the row is the identity, the name is a label on it.

Launch prompt text is overwritten **only where the stored text still exactly
equals the prior default**, following the precedent already established for
reviewed-prompt synchronization. Hand-edited prompts are left untouched. This is
how project-owned customization is preserved: renames always apply, text is
replaced only when unmodified.

The classic workflow definition is retained in the tree as a tracked reference
document that nothing reads at boot, so the previous vocabulary is legible
without recourse to version history.

### Review findings

Findings are created in `Implement`, the Implementation start stage. A finding
becomes indistinguishable from any other implementation child once created,
which is what the domain model already claimed of it.

Finding creation stays inert — it launches no agent, moves no parent, and draws
no dependency edge. Inertness is now structural rather than positional: nothing
under a Story runs until implementation kickoff.

The bulk `Ready → Implement` move that used to open a round is **deleted**, not
replaced. Round membership was never persisted, and with findings accumulating in
the start stage there is nothing to drain. The glossary term for the round is
retired in favour of the kickoff.

The parent-state precondition on filing a finding is unchanged: the parent must
be a Story in `Review`.

### Execution driver

The driver's treatment of the review stage is unchanged: a work item in `Review`
satisfies its dependents without being `Done`, both when seeding graph state and
when a live transition releases dependents. The stage keeps its name, so no
driver behaviour changes.

### Stage icons

Five new icons — grill, spec, tickets, implement, review — are added to the
shared inline-SVG icon module in its established convention: 24-unit view box,
no fill, `currentColor` stroke at 1.75 units with round caps and joins, geometry
hoisted to a module-level constant, and a numeric `size` prop defaulting to 16.
The two terminal stages reuse the existing check-circle and cross icons.

Icons resolve through a stage-name lookup with a neutral fallback glyph, so a
project-created state outside the canonical vocabulary still renders an icon
rather than a gap.

The state header row renders the icon between the collapse control and the state
name. The collapse control keeps its current position, fixed width, and role as
the leading element; the header remains a single activatable region with its
existing expanded/collapsed labelling; the icon is decorative and is not
announced. The count stays trailing.

Inline SVG is used rather than raster assets because it inherits the stage
colour through `currentColor`, stays crisp at any device pixel ratio, adds no
bundled binaries, and is the only icon idiom the application currently has.

### Out-of-band scope note

The pinned upstream skill snapshot already exists at the revision this work
targets, with the three required skills selected, their transitive closure
locked, and full launch-time verification of digests, provider versions, and
required tracker tools. No snapshot acquisition, re-pinning, or preflight change
is required. The skills work reduces to re-keying the default requirements from
the two old state names to the three new stage names, and to letting those
defaults derive from the artifact.

## Testing Decisions

A good test here asserts externally observable behaviour: what a freshly created
or freshly migrated project looks like when read back, what a launch resolves to,
what the finalization endpoint accepts and rejects, and what a person sees in the
rendered task tree. It does not assert the internal shape of the derivation
helpers, which module read the artifact, or the order of statements inside the
migration.

Five seams already exist and all five are reused; no new seam is introduced.

**Fresh-project materialization** — the existing project-creation service is the
highest seam for the whole backend change. The existing reviewed-defaults seeding
and launch-binding seeding suites already assert artifact-ordered types and
states, matching start states and edges, a complete prompt matrix, per-stage
required-skill lists, Story-only subtree-run capability, and that pre-existing
custom types, transitions, and bindings survive an additive pass. These
assertions are re-pointed at the new vocabulary and extended with the new
auto-start expectations and the human-only ticket-to-implement edge. Prior art:
the same two suites in their current form.

**Migration replay** — asserted through the same read-back seam against a project
built on the old vocabulary: states are renamed with their rows preserved, work
items keep their state identity, items in the retired state land in the
implementation stage, the graphs match the artifact afterwards, an unmodified
prompt is updated, and a hand-edited prompt is not. Prior art: the existing
reviewed-prompt synchronization migration, which established the
overwrite-only-if-unmodified filter.

**Launch-time skill resolution** — the existing required-skill launch suite is the
seam. It already asserts the frozen closure, the required tracker tools, the
pinned revision, and fail-closed behaviour on missing tools, unsupported provider
versions, and corrupt catalogs. It gains cases that a launch at each refinement
stage resolves exactly that stage's skill. Prior art: that suite as it stands.

**Defaults finalization** — the shared validator, exercised through the workbench
server suite, is the seam for the single-source change. Tests assert that a
malformed or disconnected graph, a missing prompt cell, a bad state group, and an
unknown skill identifier are each still rejected with a useful message, and that
a well-formed artifact declaring the new vocabulary is accepted. Prior art: the
existing workbench server tests around the finalization endpoint.

**Task tree rendering** — the tasks pane render seam used by the existing Studio
suites. Tests assert that each state header renders its icon, that the icon sits
between the collapse control and the state name, that a state outside the
canonical vocabulary renders the fallback rather than a gap, and that collapse,
expand, and the existing drop-target behaviour on a header are unaffected by the
added element. Prior art: the existing idea-entry and task-reorder-drag suites,
which already drive this pane and already assert header collapse and drop
behaviour.

## Out of Scope

- Acquiring, re-pinning, or upgrading the upstream skill snapshot; it is already
  present at the target revision.
- Any change to preflight resolution, digest verification, or provider
  installation.
- Making the workflow a selectable boot profile. There is one canonical default;
  the classic definition is retained as a read-only reference only.
- Redesigning PathFind. It inherits the rename and nothing else.
- Any change to how the review stage releases dependents in the execution driver.
- Editing workflow graphs or the state vocabulary from the workbench UI; the
  workbench continues to carry them through unedited.
- Editing stage icons, colours, or launch policy from Studio settings surfaces.
- Per-stage agent, model, or reasoning selection.
- Migrating archived projects or work items outside the current project.

## Further Notes

The reference image described in the refine brief was never attached to the work
item and is not present in the repository, so the icons are designed from the
stage semantics rather than traced from it. The icon glyphs are therefore the
part of this plan most likely to need a second pass; the structural work —
placement, colour inheritance, name lookup, fallback — is independent of which
glyph each stage ends up with.

The state header currently renders a Unicode triangle as the collapse control.
Replacing it with the existing chevron icon would make the row internally
consistent now that it carries an icon, but that is a separate change and is not
proposed here.

Two decisions in this plan are recorded as architecture decision records in the
work-management context: the artifact becoming the single vocabulary source, and
the split of refinement into three launchable stages. The glossary is updated in
the same context — the round-based term is retired in favour of the kickoff, the
finding term loses its dependence on the retired queue state, and stage and
chain terms are added.
