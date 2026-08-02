# T12 — Gate the Studio sidebar behind an installation feature flag

Status: Refined
Story: WorkTracker #12 (`d1d90312-0a09-4235-8c72-6ac8d92db407`)
Date: 2026-07-29
ADR: [`studio/docs/adr/0005-the-sidebar-is-an-installation-gated-surface.md`](../../../studio/docs/adr/0005-the-sidebar-is-an-installation-gated-surface.md)

## Problem Statement

Studio opens with a collapsible sidebar that the `\` key shows and hides. Inside
it sits the Modules pane, plus the Projects pane when the `projects`
installation feature flag is on. But module selection and module creation both
already live on the Module tab strip, which is always visible — so for an
installation that has switched Projects off, the sidebar is a second route to
something the user can already reach, occupying horizontal space and carrying
its own keyboard-navigation model.

An installation should be able to switch the sidebar off the same way it
switches Projects off: one line in one config file, no migration, reversible.
Today it cannot. The sidebar is unconditional, and the parts of Studio that
point at it — the `\` binding, the footer's Open/Close Menu chip, the
keyboard-shortcuts entry, the rebindable shortcut, the focus-left clause that
re-reveals a collapsed sidebar, and the startup path that forces it visible —
all assume it exists.

The first-run guided tour makes this worse. It anchors its module-creation coach
mark to the Modules pane, and forces the sidebar visible to reveal it. Any
attempt to gate the sidebar has to answer what that step points at.

## Solution

A new installation feature flag, `sidebar`, gates the whole sidebar surface. It
is read from `features.json` alongside `projects`, defaults to `false`, and is
answered once at process start.

`projects` becomes subordinate to it: it selects a pane *within* a rendered
sidebar rather than standing beside `sidebar` as a peer. The configuration
resolver coerces `projects` to false whenever `sidebar` is off, so the
configuration contract only ever describes states that can actually be
rendered, and no frontend code needs to know that one flag conditions the other.

With the flag off, the Edit view is the only Studio layout, and every affordance
that pointed at the sidebar is **absent rather than inert**: `\` is unbound, the
footer chip is gone, the shortcuts modal and the rebinding panel do not list a
sidebar toggle, focus-left stops at the leftmost Edit view zone, and startup
never reveals a sidebar. A webview that already persisted a visible sidebar has
that preference overridden by the flag, not honoured — the stored value survives
untouched so re-enabling the flag restores what the user last had.

The guided tour stops manipulating layout altogether. Its module-creation coach
mark anchors to the Module tab strip's add-module affordance unconditionally, so
the tour is identical in every flag combination, and its layout
capture-and-restore clause is deleted rather than made conditional. Its opening
step is brought into line with the Guided tour glossary entry, which already
commits to opening on module creation when the Projects surface is not enabled.

Turning the flag back on is one line in `features.json` and a restart.

## User Stories

1. As someone installing Studio for the first time, I want the sidebar switched off by default, so that my first hour is spent on stories and terminals rather than on two navigation surfaces that do the same thing.
2. As an installation owner, I want to enable the sidebar with one line in `features.json`, so that turning it on costs no migration and no rebuild.
3. As an installation owner, I want to disable the sidebar with one line in `features.json`, so that a surface I do not want is genuinely gone rather than merely collapsed.
4. As an installation owner, I want the flag answered once at process start, so that sidebar availability, pane order and keyboard traversal are settled consistently for the whole session.
5. As an installation owner, I want a `features.json` that enables Projects while disabling the sidebar to resolve to a coherent state, so that a contradictory file does not produce a half-rendered surface.
6. As a Studio user with the sidebar off, I want the Edit view to be the layout I get, so that the two-column layout is the whole story rather than a temporary state of a hidden third pane.
7. As a Studio user with the sidebar off, I want no key to be bound to a sidebar toggle, so that no keystroke silently does nothing.
8. As a Studio user with the sidebar off, I want no footer hint offering to open a menu, so that the footer only advertises actions that exist.
9. As a Studio user with the sidebar off, I want the keyboard-shortcuts reference to omit the sidebar toggle, so that the reference matches what the keyboard actually does.
10. As a Studio user with the sidebar off, I want the shortcut-rebinding surface to omit the sidebar toggle, so that I cannot assign a key to an action that cannot run.
11. As a Studio user with the sidebar off, I want leftward focus movement to stop at the leftmost Edit view zone, so that navigating left does not conjure a surface my installation has switched off.
12. As a Studio user with the sidebar off, I want startup to open directly in the Edit view with focus somewhere useful, so that the session begins in the layout I will be working in.
13. As a Studio user upgrading an installation where I had the sidebar open, I want the flag to decide what I see, so that installation configuration beats a stale per-webview preference.
14. As a Studio user re-enabling the sidebar after a period with it off, I want my previous pane widths back, so that the flag behaves like a switch rather than a reset.
15. As a Studio user with the sidebar on and Projects off, I want a sidebar holding only the Modules pane, sized to the space the Projects pane would have used, so that no gap is left where a hidden pane used to be.
16. As a Studio user with both flags on, I want the Projects and Modules panes and the pane-focus keyboard model exactly as they are today, so that enabling the flag is a return to known behaviour and not a new layout.
17. As a Studio user with the sidebar on, I want `\` to show and hide it and the footer chip to flip its verb, so that the toggle behaves as it always has when the surface exists.
18. As someone going through first-run onboarding, I want the guided tour to point at the add-module affordance on the Module tab strip, so that I am taught a surface that will still be there tomorrow.
19. As someone going through first-run onboarding with the sidebar off, I want the tour to open on module creation rather than announcing a Projects pane I cannot see, so that the first thing I am shown is real.
20. As someone going through first-run onboarding with both flags on, I want the tour to open on the project affordance the welcome screen just exercised, so that the tour continues from what I just did.
21. As someone going through first-run onboarding, I want the tour to leave my layout alone, so that finishing it does not rearrange or take away panes I was shown.
22. As someone who skips the guided tour, I want my layout untouched, so that skipping costs nothing.
23. As a developer reading the codebase later, I want one derived predicate to answer whether the sidebar exists, so that rendering, key registration and focus traversal cannot disagree.
24. As a developer reading the codebase later, I want the flag's subordination rule to live in exactly one place, so that adding a consumer does not mean re-deriving it.
25. As a developer reading the codebase later, I want an ADR explaining why the flag is named for the surface and why the subordinate flag is coerced, so that the shape is not mistaken for an accident.
26. As a consumer of the configuration contract, I want the new flag reflected in the published API schema and generated SDK, so that clients see the real response shape.
27. As a developer working on the domain model, I want the glossary to describe the sidebar as conditional and to stop claiming the tour manipulates layout, so that the documented model matches the code.

## Implementation Decisions

### The flag and its resolution

* A `sidebar` boolean joins the installation feature defaults, defaulting to
  `false`. Like `projects`, it is read from `features.json` in the local config
  directory, tolerates every read and parse failure by falling back to the
  default, and is resolved once at process start.
* The feature loader whitelists keys explicitly, as it does today; `sidebar` is
  added to that whitelist rather than the loader being made permissive.
* **The loader coerces `projects` to false whenever `sidebar` resolves false.**
  This is the single place the subordination rule lives. The configuration
  response therefore never describes an enabled pane with no surface to hold it.
* The configuration response body gains the `sidebar` field. The frontend
  configuration payload type and the loaded feature state gain it in step.
* `openapi.json` and the generated SDK models are regenerated for the new field.

### The derived predicate

* Frontend code asks one derived question — does the sidebar surface exist —
  rather than reading the raw flag at each site. Rendering, key-binding
  registration, footer composition, shortcut listings and focus traversal all
  consult that one predicate, so they cannot disagree.
* Because the backend has already coerced, the predicate for the Projects pane
  is the `projects` flag alone. The frontend does not re-implement subordination.

### The sidebar surface

* The top-level layout renders no sidebar and no resize handle when the surface
  is off; the work area occupies the full width.
* Panel-sizing must express three sidebar shapes rather than two: absent,
  Modules only, and Projects plus Modules. The current `projectsEnabled`
  boolean cannot carry three states and is replaced by a representation that
  can.
* The persisted panel layout keeps its existing four-slot shape — Projects,
  Modules, Stories, Workspace. The two sidebar slots lie dormant while the
  surface is off, so re-enabling the flag restores prior pane sizes.
* Persisted sidebar visibility is overridden by the flag rather than honoured,
  and the stored value is not rewritten, so re-enabling restores the user's last
  state.

### Keyboard, footer and discoverability

* The sidebar toggle action is **not registered** when the surface is off, so no
  key is bound to it. It is not registered-and-inert.
* The footer omits its Open/Close Menu chip; the keyboard-shortcuts modal omits
  its sidebar row; the shortcut-rebinding panel omits its sidebar label. A user
  cannot bind a key to an action that cannot run.
* Pane traversal order contains no sidebar panes, and the focus-left clause that
  re-reveals a collapsed sidebar and jumps into it is gated off, so leftward
  movement stops at the leftmost Edit view zone.
* Startup does not reveal a sidebar and focuses a pane that is actually visible.

### Guided tour

* The module-creation coach anchor moves to the Module tab strip's add-module
  affordance and is **removed from the Modules pane**, so exactly one element
  carries it in every flag combination and the anchor cannot be resolved by
  accident of DOM order.
* The tour's forced sidebar reveal, forced default panel layout, and layout
  capture-and-restore are deleted, not made conditional.
* The tour's opening step is `projects-pane` only when the Projects pane
  actually renders, and `module-create` otherwise. This closes a gap in which
  the code contradicted the Guided tour glossary entry; it was previously masked
  by the forced reveal.
* The now-unused helper that reported whether a tour step requires the Modules
  pane is deleted along with the layout manipulation it was written for.

### Documentation

* ADR 0005 records the surface-scoped flag name, the backend coercion, the
  rejected pane-scoped alternative, and the tour losing its layout clause. ADR
  0004 stays valid and is not superseded.
* The glossary's Coach mark entry currently asserts that the tour puts the
  surface into the layout its anchors need and restores the user's layout when
  it ends. That becomes false and is corrected. The Edit view and full sidebar
  view entries are updated to describe the sidebar as conditional on
  installation configuration.

## Testing Decisions

A good test here asserts what an installation and a user observe — the
configuration response for a given `features.json`, and what a rendered Studio
does when a key is pressed. None of these tests should reach for a store's
internals to check that a boolean was written; they should render the real
component tree, drive real events, and assert on what is on screen and in focus.

**No new seam is required.** Every behaviour in this spec is reachable from a
seam that already exists and already has prior art.

### Configuration contract seam

The existing configuration-endpoint tests write a `features.json`, re-resolve
the process-start feature state, and assert on the `features` object in the
`GET /api/config` response. This is the highest seam available and covers the
entire backend half: the new key's presence, its `false` default, parse and
read-failure fallback, resolution being frozen until restart, and the coercion
rule — including that a file enabling Projects with the sidebar off resolves to
both false. Prior art: the existing default, unreadable-file, and
unchanged-until-restart cases, plus the existing case asserting that profile
writes cannot disturb feature state.

### Studio rendering and keymap seam

The existing frontend tests set feature state on the configuration store and
render the real panes, footer, and keymap harness. This covers pane composition
for all three sidebar shapes, `\` being unbound versus toggling, the footer chip,
the shortcuts modal and rebinding panel listings, pane traversal and the
focus-left clause, and a stale persisted sidebar preference being overridden.
Prior art: the module tab strip tests already flip the `projects` flag to assert
pane composition, and the keymap tests already assert traversal against it.

### Bootstrap seam

The existing bootstrap tests drive startup with feature state supplied through a
mocked configuration store and assert on the resulting visibility and focus.
This covers startup not revealing a sidebar and focusing a visible pane. Prior
art: the existing cases that already vary the `projects` flag across bootstrap.

### Guided tour seam

The existing tour tests render the tour at a chosen step against a rendered
surface and assert which anchor the coach mark attaches to. This covers the
anchor living on the Module tab strip, the opening step being chosen by whether
the Projects pane renders, and the tour no longer touching layout. Prior art:
the existing per-step anchor cases and the existing coach-mark anchor-resolution
tests.

### Panel sizing

Panel sizing has no direct test file today, and this spec does not add one.
Three-shape sizing is asserted through the rendered layout at the seam above,
so the sizing representation stays an implementation detail free to change.

## Out of Scope

* Making feature flags editable from within Studio, or reloadable without a
  restart. ADR 0004 settled process-start resolution and this spec inherits it.
* Any change to the REST or MCP contract beyond adding the flag to the
  configuration response. Projects and modules remain fully addressable over
  both regardless of flag state.
* Removing the Modules pane, the Projects pane, or the sidebar as code. This is
  a gate, and it is reversible by construction.
* A migration that writes `features.json` on upgrade to preserve an existing
  installation's sidebar. Existing installations lose the sidebar until they opt
  back in; ADR 0005 records this as accepted.
* Redesigning the Module tab strip. It is treated as an existing, sufficient
  surface for module selection and creation, not as something to extend.
* Any per-pane flag beyond `projects`, and any general pane-registry mechanism.
* Changing what the guided tour teaches, its step count, or its copy beyond the
  opening-step selection and the relocated anchor.

## Further Notes

* The helper reporting whether a tour step requires the Modules pane is
  currently exported with no callers — scaffolding for exactly this work. It is
  deleted rather than wired up, because relocating the anchor removes the
  question it answered.
* The coach-mark implementation resolves its anchor with a single-element query
  and degrades to a centred in-flow dialog when the anchor is missing. That
  degradation is why the orphaned opening step is a wrong-content bug rather
  than a crash, and why leaving two elements carrying the same anchor would fail
  silently by DOM order. Both are reasons the anchor moves rather than being
  duplicated.
* Default-off is only safe because the Module tab strip carries module selection
  and creation. If a future sidebar pane offers a capability with no equivalent
  elsewhere, ADR 0005's default should be revisited.