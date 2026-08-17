# CODING-724 — Mouse controls for terminal panel size

Status: Spec complete  
Story: WorkTracker #724 (`ea40aa9a-123b-4e00-9c4e-d11288ff96be`)  
Date: 2026-08-16  
Related foundation: [CODING-650 — Bottom terminal panel](../T650--i-need-a-bottom-terminal-vs-code-style-b/SPEC.md)

## Problem Statement

Studio's terminal panel can be opened and closed with its keyboard shortcut and
can be resized by dragging its top edge. A person using the mouse has no visible
control for quickly giving the terminal the available workspace height, hiding
it when it is in the way, or bringing it back after it has been hidden.

The resize grip is useful for fine adjustment, but it is not a substitute for
discoverable panel furniture. The current interaction makes a basic layout
change depend on knowing a shortcut or accurately dragging a one-pixel boundary.
That is especially awkward when reading a long test run, temporarily returning
to the work item, or using a trackpad or another imprecise pointing device.

## Solution

Give the terminal panel visible, mouse-clickable window furniture.

The right side of the panel header gains a **maximize/restore** button and a
**minimize** button. Maximize gives the terminal panel all of the height allowed
by its existing workspace safety bound; the same control then restores the
person's previous ordinary height. Minimize hides the panel through the same
non-destructive panel-close action used by the existing toggle: shell runs stay
alive and no tab is closed.

Because a hidden panel cannot contain its own restore button, the Studio footer
also gains an always-available **Terminal** button. It opens a hidden panel and
minimizes a visible one through the existing shared panel-toggle action. This
makes the complete open, enlarge, restore, and hide loop possible with a mouse
without introducing a second definition of panel behavior.

These controls affect the bottom terminal panel only. They do not move, resize,
or relabel agent terminal tabs in the selected Story workspace, and they do not
change shell or agent-run lifecycle semantics.

## User Stories

1. As a mouse user, I want a visible terminal control in Studio, so that I do
   not have to know the panel shortcut before I can open a shell.
2. As a mouse user, I want to minimize the visible terminal panel with one
   click, so that I can return the space to the Stories and work-item panes.
3. As a mouse user, I want to reopen a minimized terminal panel with one click,
   so that minimizing it does not leave me dependent on the keyboard.
4. As a developer reading a long command result, I want to maximize the panel
   with one click, so that I can see substantially more terminal output.
5. As a developer who maximized the panel temporarily, I want the same control
   to restore my previous height, so that I do not have to reconstruct my
   preferred layout by dragging.
6. As a developer, I want maximize to respect the existing upper bound, so that
   the terminal cannot swallow the entire module workspace.
7. As a developer, I want minimize to hide rather than terminate my shell, so
   that long-running commands continue while I inspect the work item.
8. As a developer with several panel shell tabs, I want panel sizing to leave
   the tab set and active shell unchanged, so that a layout action does not
   become a session action.
9. As a developer, I want reopening the panel to return to the same active
   shell, so that I resume the terminal I was using.
10. As a developer, I want a maximized panel to remain maximized when I hide and
    reopen it, so that minimizing does not silently alter its size mode.
11. As a developer, I want Studio to remember the panel's size mode across a
    restart, so that the existing panel-furniture persistence remains honest.
12. As a developer, I want restore to survive that restart too, so that a
    maximized panel can still return to the ordinary height I chose earlier.
13. As a developer, I want a maximized panel to follow the current window size,
    so that resizing the Studio window cannot leave the panel above its safety
    bound or stranded at a stale pixel height.
14. As a developer, I want dragging a maximized panel to establish a new
    ordinary height, so that direct manipulation remains authoritative.
15. As a developer, I want the existing resize grip to keep working before and
    after using the new buttons, so that quick sizing and fine sizing compose.
16. As a desktop user, I want maximizing to resize the existing native terminal
    viewer in place, so that a layout change does not restart, detach, or
    duplicate my durable shell.
17. As a browser-development user, I want the same controls and sizing behavior,
    so that the compatibility renderer is not a reduced interface.
18. As a keyboard user, I want every new control to be reachable and operable as
    a real button, so that adding mouse affordances does not create pointer-only
    behavior.
19. As a screen-reader user, I want the controls named by their current action,
    so that I can distinguish Maximize, Restore, Minimize, and Open terminal
    panel without interpreting an icon.
20. As a user, I want hover text to explain each compact icon control, so that
    the panel furniture is discoverable without trial and error.
21. As a user navigating shell tabs, I want the sizing controls outside the tab
    list's semantics, so that assistive technology does not announce layout
    actions as terminal tabs.
22. As a developer typing in the panel shell, I want a sizing click to be
    consumed by the panel furniture, so that it cannot become input to the
    terminal underneath it.
23. As a developer, I want the existing panel shortcut to continue opening and
    minimizing the panel exactly as before, so that adding buttons does not
    fork keyboard and mouse behavior.
24. As a maintainer, I want one panel action model shared by the footer,
    toolbar, shortcut, persistence, and tests, so that those entry points cannot
    drift into different notions of open, maximized, or restored.
25. As a maintainer, I want this feature to stay within Studio's terminal-panel
    presentation code, so that a layout affordance does not widen the terminal
    API, native boundary, or backend domain.

## Implementation Decisions

### Meaning and placement of the controls

* **Minimize means hide the terminal panel**, not shrink it to the minimum
  resizable height and not close the active shell tab. It invokes the existing
  panel-close/toggle policy, which already updates the edit-view navigation
  zone and releases the mounted viewer without ending the durable shell run.
* The visible panel's layout controls sit as a compact group at the trailing
  edge of its header, aligned with but semantically separate from the shell tab
  list. Shell selection, new-shell, close-shell, and panel furniture remain
  distinct actions.
* The footer carries an always-visible Terminal toggle. When the panel is
  hidden its accessible action is **Open terminal panel**; when visible it is
  **Minimize terminal panel**. It calls the same shared toggle used by the
  existing shortcut rather than writing panel state directly.
* The maximize button's accessible action is **Maximize terminal panel** in an
  ordinary size and **Restore terminal panel size** while maximized. Compact
  icons are decorative; labels and hover text carry the meaning.
* New icon geometry follows Studio's existing inline, current-color icon set.
  No icon package or remote asset is introduced.

### Panel size model

* Panel furniture has two size modes: **ordinary** and **maximized**. Hidden is
  still the existing open/closed presentation state, not a third size mode.
* Maximized height is calculated from the panel geometry policy at the time it
  renders. It uses the existing maximum pixel and viewport-share bounds, so
  module tabs, the footer, and a usable portion of the work-item workspace
  remain available. It is not application fullscreen or operating-system
  window maximize.
* Entering maximized mode captures the current clamped ordinary height as the
  restore height. Restoring returns to that exact height, clamped against the
  current viewport in case the Studio window became smaller.
* Minimizing and reopening preserve the current size mode. A panel minimized
  while maximized reopens maximized; restoring still returns to the captured
  ordinary height.
* The open flag, size mode, ordinary restore height, and current ordinary height
  are one global panel-furniture record and retain the existing debounced
  persistence behavior. Corrupt, missing, or legacy records fall back through
  the same clamping/default policy used today; a legacy record is ordinary at
  its recorded height.
* While maximized, viewport changes recompute the rendered maximum rather than
  persisting a transient viewport-derived pixel value as the person's ordinary
  preference.
* Beginning a pointer drag or using the resize separator's keyboard nudge while
  maximized leaves maximized mode and treats the resulting clamped height as the
  new ordinary height. Fine resizing therefore never fights a hidden maximize
  flag.

### Shared actions, focus, and terminal ownership

* Panel opening and minimizing continue through the existing shared toggle
  coordinator, including edit-view zone handoff and terminal focus restoration.
  The footer and header do not duplicate those rules inside view components.
* Maximize and restore change only panel furniture. They do not select a shell,
  change a terminal foreground claim, create a run, or synthesize terminal
  input.
* A size change lets the existing host measurement pipeline resize whichever
  renderer is active. Native libghostty keeps the same viewer handle and gets
  an updated clipped frame/grid; the browser renderer fits the same mounted
  terminal. No new Tauri command, WebSocket behavior, attachment, or terminal
  transport is introduced.
* Minimizing retains the current lazy-viewer guarantee: the panel body unmounts,
  its viewer is no longer presented, and the durable shell remains alive in
  tmux. Reopening uses the existing active-shell discovery and presentation
  path.

### Structure and compatibility

* The size-state transition policy, panel toolbar rendering, and footer entry
  point remain separate focused concerns within the terminal-panel and app-shell
  domains. The shell tab-strip component does not become the owner of persisted
  layout state.
* The existing terminal-panel resize bounds and persistence record are extended
  rather than creating a parallel maximization store.
* The existing native-terminal/browser fallback, shell cap, module scoping,
  active-shell memory, panel shortcut, navigation-zone cycle, and shell exit
  behavior remain unchanged.
* This is a Studio-only presentation change. It requires no backend model,
  endpoint, generated SDK, MCP, terminal runtime, or native bridge changes.

## Testing Decisions

A good test observes the mounted Studio behavior a person can use: which
buttons are available, the panel height and visibility they produce, whether
the same shell remains alive, and what survives a reload. It should not assert
private component state, Zustand action call order, icon path geometry, or a
specific renderer's implementation details.

One existing seam is sufficient: the **Studio overhaul terminal-panel furniture
acceptance seam**. It is the highest seam for this behavior and already drives
the real panel, global keymap, resize separator, persisted furniture, and
renderer boundary against controlled fakes. The implementation adds the next
numbered acceptance case to the overhaul matrix and covers:

* The footer opens a hidden panel by pointer, its label flips to Minimize, and
  the panel's own Minimize control hides it through the same action.
* Minimizing and reopening retain the same shell run and active shell tab and do
  not call shell termination, create a replacement shell, or leave a viewer
  presented while hidden.
* Maximize reaches the geometry policy's current upper bound; its label changes
  to Restore; Restore returns to the exact prior ordinary height.
* Repeated maximize/restore clicks are idempotent and never drift the ordinary
  height.
* A drag or separator keyboard nudge from maximized mode establishes a new
  ordinary height, after which maximize/restore returns to that height.
* A viewport resize recomputes maximized height while preserving the ordinary
  restore height.
* Open state, maximized mode, and restore height survive the same reload seam as
  today's panel height; a legacy persisted height restores as ordinary.
* The controls are real named buttons with action-accurate labels and hover
  text, and the panel toolbar is not exposed as part of the shell tab list.
* Native and browser presentation fakes observe a resize of the existing
  terminal rather than a second attach, run creation, shell close, or lifecycle
  change.
* The existing numbered terminal-panel cases remain green, especially pointer
  dragging, shortcut toggling, typing-mode focus restoration, lazy attachment,
  and persistence.

Before handoff, run the required numbered overhaul gate for Studio. No backend
test seam is added because the feature changes no backend or wire behavior.

## Out of Scope

* Moving, maximizing, minimizing, or otherwise changing agent terminal tabs in
  the selected Story workspace.
* Fullscreening the Ticketry application or controlling the operating-system
  window.
* Terminal splits, additional shell tabs, shell renaming, or subprocess-aware
  tab labels.
* Changing the panel's resize limits, default height, location, module scope, or
  relationship to the sidebar.
* Adding or changing keyboard shortcuts.
* Ending, suspending, restarting, or otherwise changing a shell run when the
  panel is minimized.
* Backend, SDK, MCP, tmux, terminal transport, or native renderer API changes.
* Creating Implementation work items during the Spec stage.

## Further Notes

This specification extends CODING-650's terminal panel without revisiting its
domain decisions. The panel remains a module-scoped shell surface, its open
state and size remain global window furniture, its shell set remains
module-scoped content, and its toggle remains strictly open/closed. Maximized is
only a size mode within the open panel; it does not turn the existing toggle
into a focus-dependent third state.

The important regression boundary is lifecycle neutrality. A person is asking
for faster layout changes, not new terminal semantics: maximize must be a frame
resize, and minimize must be the existing reversible hide operation.
