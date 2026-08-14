# T364 — Couple of navigation fixes

Status: Spec complete  
Story: WorkTracker #364 (`9d122c40-698f-4f39-a2ac-f2218f4f345d`)  
Date: 2026-08-14  
Related decisions: [Grill decisions](DECISIONS.md)

## Problem Statement

Keyboard navigation in the Edit view currently makes a common movement take an
unnecessary intermediate step. When a person presses ArrowRight on a selected
Story that has nothing left to expand, Studio moves from the Stories navigation
zone to the workspace tab strip. The person is usually trying to enter the
Active tab body, which currently requires another key press.

The Stories pane also no longer presents a work item's compact identifier and
name as one left-aligned label. The identifier was moved to the row's trailing
edge, separating two values people scan together and making long lists harder
to read.

The Story also proposed making ArrowLeft leave an engaged tab body when its
text caret is at the first position. That behavior cannot be made consistent
across the Task workspace: in terminal typing mode the shell owns the key and
Studio cannot reliably observe the shell's cursor position. Intercepting the
key would break ordinary shell line editing. Un-engaged bodies already support
ArrowLeft back to the Stories list, while Cmd+Esc remains the explicit way to
leave an engaged body.

## Solution

In the three-zone Edit view, ArrowRight on a selected Story becomes a direct
dive into the Active tab body when the Story has nothing left to expand. It
uses the same destination and focus behavior as Enter. Stories with collapsed
children continue to expand first, preserving the tree's existing
Left/Right symmetry.

The workspace tab strip remains available through ArrowUp from the Active tab
body and through Shift+Tab navigation-zone cycling. Full sidebar view keeps its
existing pane-focus navigation.

Each ordinary work-item row in the Stories pane returns to one left-aligned,
truncating label in the form `T364 · Story name`. The compact identifier keeps
its workflow-state color. Agent-status and automation-failure indicators remain
separate trailing elements. Rows without a resolvable compact identifier do
not render a separator or a fallback key.

The proposed caret-aware ArrowLeft behavior is explicitly not implemented.

## User Stories

1. As a keyboard user in Edit view, I want ArrowRight on a selected Story to
   enter its Active tab body, so that the common path from a Story to its
   content takes one key press.
2. As a keyboard user, I want ArrowRight to enter the same body that Enter
   enters, so that equivalent dive gestures do not produce different focus or
   tab-selection behavior.
3. As a keyboard user, I want the Story's remembered Active tab to remain the
   destination of the dive, so that returning to a Story restores my working
   context.
4. As a keyboard user, I want ArrowRight on a collapsed Story with children to
   expand that Story before leaving the Stories zone, so that I can reveal its
   children without losing my place.
5. As a keyboard user, I want ArrowRight on an already expanded Story to dive
   into the Active tab body, so that an expanded tree does not add an
   unnecessary tab-strip stop.
6. As a keyboard user, I want ArrowLeft in the Stories zone to keep collapsing
   an expandable Story, so that Left and Right retain their tree semantics.
7. As a keyboard user, I want ArrowUp from an un-engaged Active tab body to
   move to the workspace tab strip, so that the tabs remain one key away.
8. As a keyboard user, I want ArrowLeft from an un-engaged Active tab body to
   return to the Stories list, so that the existing route back remains intact.
9. As a keyboard user, I want Shift+Tab to keep cycling through Stories, tab
   strip, and Active tab body, so that every navigation zone remains directly
   reachable.
10. As a keyboard user, I want the tab strip's Left, Right, Down, and Enter
    behavior to remain unchanged, so that highlighting and committing tabs
    still work as learned.
11. As a terminal user, I want ArrowLeft in terminal typing mode to continue
    reaching the shell, so that cursor movement and line editing are not
    broken by Studio navigation.
12. As a terminal user, I want Cmd+Esc to remain the explicit exit from
    terminal typing mode, so that leaving an engaged terminal is predictable.
13. As an editor user, I want engaged body controls to retain ownership of
    their editing keys, so that Studio does not introduce editor-only
    caret-boundary behavior that terminals cannot share.
14. As a Full sidebar view user, I want pane-focus arrow navigation to remain
    unchanged, so that this Edit-view refinement does not affect the other
    layout.
15. As a Ticketry user scanning the Stories pane, I want the compact identifier
    to appear before the work-item name, so that identity and title read in
    their natural order.
16. As a Ticketry user, I want the identifier and name to form one visual label
    separated by a middle dot, so that they scan as one unit rather than as
    opposite ends of a row.
17. As a Ticketry user scanning long names, I want the combined label to
    truncate within the available row width, so that trailing status indicators
    remain visible without moving the identifier away from the name.
18. As a Ticketry user, I want the compact identifier to retain the selected
    work item's workflow-state color, so that state remains visible at a glance.
19. As a Ticketry user, I want nested work-item rows to use the same label order
    and indentation as root rows, so that hierarchy does not change the reading
    convention.
20. As a Ticketry user, I want rows without a compact sequence identifier to
    omit both the identifier and separator, so that unresolved data does not
    produce misleading or broken labels.
21. As a Ticketry user, I want agent-state and automation-failure indicators to
    remain at the trailing edge, so that operational status stays distinct from
    the work-item label.
22. As a maintainer, I want these behaviors covered through the real mounted
    Studio navigation and rendering boundary, so that tests protect user-visible
    behavior rather than internal helper calls.

## Implementation Decisions

- Limit the navigation change to the three-zone keyboard router used by Edit
  view. Do not alter the Full sidebar view router or global pane-focus actions.
- Preserve the existing expand-first rule. ArrowRight expands the selected
  Story when it is expandable and collapsed; only a Story with nothing left to
  expand attempts the workspace dive.
- Route the ArrowRight dive through the Task workspace's existing public
  `dive-active` action. Do not duplicate tab restoration, zone state, or focus
  behavior in the Stories-zone router.
- A successful dive sets the navigation zone to Active tab body and restores
  the selected Story's Active tab exactly as Enter does. If no navigable Task
  workspace exists, the event remains unavailable rather than moving to a
  misleading zone.
- Keep ArrowUp from an un-engaged Active tab body mapped to the workspace tab
  strip and ArrowLeft mapped to the Stories zone. Keep Shift+Tab zone cycling
  unchanged.
- Do not add caret-position inspection or ArrowLeft interception for engaged
  tab bodies. Terminal typing mode continues to give all keys except Cmd+Esc to
  the terminal; other engaged surfaces retain their current key ownership.
- Restore the Stories-row label as a single left-aligned truncating unit:
  compact display identifier, middle-dot separator, then work-item name.
- Continue deriving the compact identifier through the shared work-item
  display-identifier contract. Do not expose canonical tracker keys when the
  compact identifier cannot be resolved.
- Apply the workflow-state color only to the identifier token. Preserve the
  existing muted fallback styling when no state color is available.
- Keep expansion carets before the label and agent/automation indicators after
  it. Preserve selection, pointer, drag, indentation, and preload behavior.
- No backend, database, API, generated SDK, Tauri, terminal-renderer, or tmux
  changes are required.
- The Studio navigation glossary already describes the agreed direct-dive
  behavior. Keep that terminology authoritative: Edit view, Navigation zone,
  Navigation mode, Terminal typing mode, Active tab, Stories pane, and Task
  workspace.
- No ADR is required because the change is local, reversible, and does not
  introduce a new cross-boundary contract.

## Testing Decisions

- Use the mounted Studio acceptance harness as the single highest test seam.
  It exercises the real global keymap, client navigation state, Task workspace,
  Stories tree, and rendered work-item rows while controlling only the HTTP and
  notification boundaries.
- Add or update a numbered overhaul acceptance case that begins in the Stories
  zone and proves ArrowRight expands a collapsed Story first, then dives
  directly into the remembered Active tab body once there is nothing left to
  expand. Assert the tab strip is not the intermediate destination.
- In the same navigation acceptance coverage, prove ArrowUp from the body
  reaches the workspace tab strip, ArrowLeft from an un-engaged body returns to
  Stories, and Full sidebar view navigation is unchanged.
- Extend the existing work-item-row acceptance coverage through the same
  mounted Studio seam. Assert DOM reading order is caret, combined
  `identifier · name` label, then status indicators; verify state color,
  truncation, nesting, selection, and rows without an identifier.
- Treat visible destination, active tab, navigation-zone state, focus, and
  rendered text order as observable behavior. Do not assert private router
  helper calls, component implementation details beyond accessible/visual row
  order, or internal store transition sequences.
- Keep the numbered overhaul acceptance matrix and gate count current for the
  added or changed user-visible cases.
- Run `npm run test:overhaul --workspace @worktracker/studio` before the
  implementation handoff, along with the affected Studio tests and typecheck.

## Out of Scope

- Creating implementation tickets, child work items, dependency edges, or an
  execution graph during the Spec stage.
- ArrowLeft navigation based on an engaged editor or terminal's caret/cursor
  position.
- Changing Cmd+Esc or any other terminal typing-mode key ownership.
- Changing workspace tab-strip highlighting, tab ordering, tab closing,
  document behavior, terminal behavior, or Active-tab persistence.
- Changing module-tab keyboard shortcuts or the Module tab strip.
- Changing Full sidebar view pane-focus navigation.
- Changing tree selection, expand/collapse persistence, search, drag and drop,
  workflow grouping, indentation, or agent-status presentation.
- Introducing a new identifier format, workflow-state color rule, backend
  field, API response, or persistence mechanism.
- Redesigning the Stories pane beyond restoring the agreed left-aligned label.

## Further Notes

- The central navigation invariant is: Right expands when expansion remains;
  otherwise Right dives to the Active tab body. The workspace tab strip is a
  sibling navigation zone, not a mandatory waypoint.
- The rejected caret-aware Left behavior is recorded so implementation does not
  accidentally create inconsistent editor-only behavior or steal terminal
  keystrokes.
- The row-layout decision restores the earlier `identifier · name` reading
  model while retaining the newer workflow-state color cue.
