# T83 — Configure a workflow state from the Stories pane

Status: Ready for agent
Story: WorkTracker #83 (`7a21698c-7bfa-4777-ab3b-30215e351b0d`)
Date: 2026-08-01
ADR: [`studio/docs/adr/0007-state-configuration-opens-over-the-mounted-task-workspace.md`](../../../studio/docs/adr/0007-state-configuration-opens-over-the-mounted-task-workspace.md)

## Problem Statement

The launch policy for a workflow state is currently buried in Settings under
Workflow → Issue Types and then inside an individual state's launch disclosure.
That route is too distant from the Stories pane, where users already think and
act in terms of states, and its four-row prompt editor makes a substantial agent
prompt difficult to read or revise.

Users need a direct route from a real state header to the policy for that state,
without turning the header itself into a second action, hiding the Story they
were working on, or tearing down live terminals and document tabs in the
workspace pane. The direct surface must edit the same project-scoped workflow
policy as Settings, with the same write timing and optimistic-concurrency
protection, so the convenient route cannot become a competing configuration
system.

## Solution

Each real state header in the Stories pane gains an always-visible settings gear
at its right edge. The gear is visually muted until hover and is independent of
the header's collapse/expand action. Selecting it opens a state configuration
panel over the workspace pane while leaving the existing workspace mounted
underneath.

The panel is one vertically scrolling page. It names the state, lets the user
choose among issue types whose workflow contains that state, and defaults to
Story whenever Story is eligible. It then shows, in order, a tall launch-prompt
editor with provider, model, and reasoning controls; every workflow transition
leading into or out of the state with its agent permission; and the Auto-start
and Run subtree controls.

The panel reads and writes through the existing workflow editor store and uses
the existing launch configuration form. Changes retain the Settings editor's
commit-on-change/blur behavior and revision-guarded writes. A pair with no launch
binding displays an empty form, and its first edit creates the binding. Closing
the panel restores the still-live workspace exactly as it was.

## User Stories

1. As a Studio user viewing Stories, I want to open a state's configuration from that state's header, so that I do not have to navigate through Settings.
2. As a Studio user scanning state groups, I want the configuration gear to remain visible but muted until hover, so that the action is discoverable without dominating the list.
3. As a Studio user, I want clicking a state header to continue doing only collapse or expand, so that an established interaction does not change meaning.
4. As a Studio user, I want clicking the gear to leave the state's collapsed state unchanged, so that configuring a state does not rearrange my Stories pane.
5. As a Studio user, I want the synthetic No state group to have no configuration gear, so that Studio does not offer workflow policy for a state that does not exist.
6. As a keyboard or assistive-technology user, I want the gear to be a separately named control, so that collapse/expand and configuration are distinguishable actions.
7. As a Studio user, I want the panel heading to identify the selected state, so that I always know what I am configuring.
8. As a Studio user, I want the panel to occupy the workspace pane, so that a full launch prompt and workflow controls have enough room to be legible.
9. As a Studio user with a live terminal, I want opening and closing state configuration to preserve the terminal instance, so that its process, scrollback, and input state survive.
10. As a Studio user with open document tabs, I want opening and closing state configuration to preserve those tabs and their current state, so that configuration is not a workspace reset.
11. As a Studio user, I want clicking the same gear again to close the panel, so that the trigger behaves as a toggle.
12. As a Studio user, I want a clearly labelled close control in the panel, so that I can dismiss it without finding the originating row.
13. As a Studio user, I want selecting a Story to close state configuration and show that Story's workspace, so that Story selection always wins.
14. As a Studio user, I want changing modules or projects to close state configuration, so that project-scoped policy never appears under the wrong context.
15. As a Studio user, I want one page with one vertical scrollbar, so that I can read the configuration from top to bottom without managing nested scroll regions.
16. As a Studio user, I want to choose only issue types whose workflow contains this state, so that every offered state/type pair is meaningful.
17. As a Studio user, I want Story selected by default when its workflow contains the state, so that the common Stories-pane case takes no extra choice.
18. As a Studio user opening a state that is not in the Story workflow, I want the first eligible issue type selected, so that the panel still opens on a valid pair.
19. As a Studio user, I want changing issue type to replace every displayed value with that type's policy for the state, so that values from one pair cannot leak into another.
20. As a Studio user, I want a substantially taller prompt editor than the Settings disclosure provides, so that I can read and revise a complete workflow prompt comfortably.
21. As a Studio user, I want provider, model, and reasoning controls beside the prompt configuration, so that the entire launch binding is editable from the panel.
22. As a Studio user opening an unconfigured state/type pair, I want an empty form rather than inherited or placeholder policy, so that absence is represented honestly.
23. As a Studio user editing an unconfigured pair, I want the first committed edit to create its launch binding, so that no separate setup action is required.
24. As a Studio user, I want text changes committed when I leave the field and picker changes committed when selected, so that this surface behaves like the existing Settings editor.
25. As a Studio user, I want invalid provider, model, or reasoning combinations explained inline, so that a rejected configuration can be corrected where it was entered.
26. As a Studio user, I want every transition into and out of this state listed with its direction and endpoints, so that the state's place in the workflow is understandable from one section.
27. As a Studio user, I want each transition to say Agents + people or People only, so that agent permissions are visible without opening another editor.
28. As a Studio user, I want to change each listed transition's agent permission, so that I can control which moves agents may make around this state.
29. As a Studio user, I want Auto-start disabled until the pair has a valid launch configuration, so that I cannot enable a launch that cannot run.
30. As a Studio user, I want Run subtree editable even when no launch configuration exists, so that it preserves the existing workflow-policy semantics.
31. As a Studio user, I want successful writes reflected immediately throughout the panel, so that subsequent writes use the newest workflow revision.
32. As a Studio user whose workflow was edited elsewhere, I want Studio to reload the latest policy on a revision conflict and tell me what happened, so that this panel cannot overwrite a newer Settings edit.
33. As a Studio user with draft prompt text during a revision conflict, I want that draft to remain in the editor, so that refreshing authoritative policy does not erase my work.
34. As a Studio user, I want a rejected permission or toggle write shown beside the touched control, so that the rest of the page remains usable and the failure is actionable.
35. As a user who still prefers Settings, I want its Workflow → Issue Types editor to remain unchanged, so that the new panel is an additional route to the same policy rather than a migration.
36. As a developer maintaining workflow configuration, I want the panel and Settings to share one store, one form, and the existing API operations, so that their behavior cannot drift.

## Implementation Decisions

### Trigger and selection ownership

- A settings gear is added at the right edge of every real state header. It is
  rendered whenever the row has a state identifier and omitted for No state.
- The gear is its own button with an accessible name that includes the state.
  Its activation stops propagation to the row, while the remainder of the row
  retains the existing collapse/expand handler and accessible expanded state.
- State configuration is represented as a second workspace selection kind,
  carrying the project and state identifiers. It does not replace or clear the
  selected work item. The selected work item's WorkspacePane remains mounted
  beneath the overlay.
- Activating the gear for the already-open state clears the overlay selection.
  Activating another state gear replaces it. The panel close control also clears
  it.
- A Story selection clears the overlay before showing the Story. Project and
  module selection changes clear it as part of changing scope. The overlay is
  never persisted across those boundaries.

### Panel composition and scrolling

- The state configuration panel is rendered above the mounted workspace within
  the existing right-hand pane. It is not added to the work-item tab strip, does
  not replace Details, and is not a modal or popover, as recorded by ADR 0007.
- The panel owns one vertical scroll container. Its header and all four content
  sections participate in normal document flow; there is no fixed/flexible
  vertical split and no nested scrolling section.
- The sections appear in this order: issue type, launch configuration,
  transitions, then Auto-start and Run subtree.
- Loading, empty, notice, and error states render inside this same scrolling
  surface. The mounted workspace remains hidden by the overlay, not unmounted.

### Issue-type and workflow scope

- Opening the panel loads the current project's configurable task-level issue
  types, state catalog, provider capabilities, and workflow settings through the
  existing workflow editor store. Module-level issue types remain excluded.
- Eligibility is computed from workflow membership, using the same reachable
  state definition as the Settings workflow editor: the start state and every
  state reachable from it through configured transitions. Only eligible issue
  types appear in the selector.
- Story is selected first when eligible. Otherwise the first eligible type in
  the store's stable issue-type order is selected. If no type contains the
  state, the panel explains that no workflow is available and renders no write
  controls.
- The active form and controls are scoped to the selected issue type and state.
  Changing the type reinitializes pair-local form state from that pair's binding
  so prompt, provider, model, reasoning, errors, and in-flight state cannot leak
  across types.

### Shared data and write behavior

- The panel mounts the existing LaunchConfigurationForm against the existing
  workflow editor store. Settings and the panel consume the same authoritative
  per-type workflow snapshots and the same control operations.
- The shared form accepts a presentation option for a tall prompt editor. The
  state configuration panel uses the tall presentation; the Settings editor
  retains its current compact four-row presentation and behavior.
- Prompt text commits on blur. Provider, model, and reasoning selections retain
  the form's existing change/commit behavior. Provider capability validation and
  normalization of empty optional values remain shared.
- No binding is synthesized for display. An absent binding supplies empty prompt
  and picker values; the first committed form edit calls the existing upsert
  operation.
- All writes include the currently loaded `workflow_revision`. An authoritative
  successful response replaces the type's cached snapshot before another
  control can write, keeping revision sequencing shared with Settings.
- On HTTP 409, the existing store behavior reloads the latest workflow, publishes
  the concurrency notice, and preserves in-progress form input. Other rejected
  writes remain attached to the touched control.
- Existing contracts remain unchanged:
  `PUT /issue-types/{id}/workflow-settings/launch-bindings/{state_id}` updates
  the launch binding; `PATCH .../auto-start` updates Auto-start; and
  `PUT .../subtree-run` updates Run subtree. Transition permissions continue to
  use the existing revision-guarded permission operation. There are no backend,
  schema, or generated-SDK changes.

### Transitions and entry controls

- The transitions section lists every configured edge whose source or
  destination is the selected state. Direction and both endpoint names are
  explicit so incoming and outgoing moves cannot be confused.
- Each edge exposes only its existing agent-allowed permission in this panel,
  labelled as Agents + people when enabled and People only when disabled. Adding
  or removing transitions remains outside this surface.
- Auto-start and Run subtree are shown after transitions and retain current
  semantics. Auto-start can be enabled only when the selected pair has a valid
  launch binding; Run subtree does not require one. Both controls write through
  the workflow editor store and show control-scoped failures inline.

### Documentation

- The State configuration panel glossary entry is the canonical domain term for
  this surface. It distinguishes state policy from work-item details and states
  that Settings and the panel are two views of one policy.
- ADR 0007 records why the panel overlays a mounted WorkspacePane and rejects a
  workspace tab, replacement Details content, a modal, and a popover.

## Testing Decisions

A good test asserts visible behavior through a rendered user-facing surface and
drives the same events a user drives. Store fields, component-local state, and
CSS implementation details are not assertions. Network operations may be
mocked at the existing workflow API boundary so request scope, payload, revision,
and authoritative responses remain observable.

**No new test seam is required.** The feature is covered at two existing seams:
the Studio workflow-settings integration seam and the rendered Stories-pane
interaction seam.

### State configuration panel seam

- Extend the existing Studio workflow settings test patterns by rendering the
  real state configuration panel with the existing workflow API boundary mocked.
- Assert that only eligible task-level issue types are offered, Story wins the
  default when eligible, the fallback is deterministic, type changes show the
  correct pair-local values, and an absent binding renders an empty form whose
  first edit upserts.
- Assert the single scrolling-page structure, the prescribed section order, the
  tall prompt editor, and the absence of nested scroll regions.
- Assert launch prompt blur, provider/model/reasoning commits, Auto-start gating,
  Run subtree without a binding, transition permission writes, incremented
  revisions after authoritative responses, inline failures, and 409 refresh with
  draft prompt preservation. Prior art is the existing Settings integration
  coverage for these same operations.
- Assert both incoming and outgoing transitions are listed once with direction
  and the correct Agents + people or People only state.
- Render a workspace with a live test terminal/document host, open and close the
  overlay, and assert the underlying mounted instance retains identity and state.
  Assert the close button, same-gear toggle, Story selection, module change, and
  project change each dismiss the panel.

### Stories-pane interaction seam

- Extend the existing rendered Stories-pane patterns with a real state header.
  Assert that a real state has a separately named gear and No state does not.
- Clicking the gear opens or closes configuration without invoking the collapse
  handler or changing `aria-expanded`. Clicking the rest of the header changes
  collapse state without opening configuration.
- Exercise the controls through click and keyboard activation so the independent
  accessible actions are covered rather than testing event propagation as an
  implementation detail.

## Out of Scope

- Editing `required_skills` from the state configuration panel.
- Selecting or changing an issue type's start state.
- Adding, removing, or otherwise reshaping workflow transitions; this panel only
  changes their Agents + people / People only permission.
- Any visual, behavioral, or information-architecture change to Settings →
  Workflow → Issue Types, including making its prompt editor taller.
- New workflow endpoints, backend models, migrations, OpenAPI changes, or SDK
  regeneration.
- Turning state configuration into a work-item tab, replacing Details, or
  presenting it as a modal or popover.
- Persisting an open state configuration panel across a Story, module, project,
  application, or webview session.
- Creating implementation tickets as part of this specification stage.

## Further Notes

- The motivating accessibility problem is spatial and interactional: the prompt
  needs enough room to be read, and the direct action must remain distinct from
  the state header's collapse target.
- The glossary entry and ADR were agreed before this specification and are
  normative inputs to implementation.
- The repository's existing xterm and document-tab lifetime guarantees are a
  hard acceptance constraint: visually restoring the workspace is insufficient
  if opening the panel remounts it.
