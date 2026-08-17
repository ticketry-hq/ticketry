# T730 — The panel's open state belongs to the module

Status: Implemented
Story: WorkTracker #730 (`061126da-4a60-4c34-a0cb-6646519fd050`)
Date: 2026-08-16
Supersedes one decision in [T650](../T650--i-need-a-bottom-terminal-vs-code-style-b/SPEC.md)

## Problem

T650 split the terminal panel's state two ways: the open flag and the height
were treated as *window furniture*, while the shell set and the active tab were
kept per module. The open flag was on the wrong side of that line.

A module is a repository someone works in, and whether that work wants a shell
in front of it is a fact about the repository, not about the window. The module
an agent is driving wants the panel shut; the one a dev server runs in wants it
open. One window-wide flag can only ever be right for one of them, so switching
modules either buried the terminal someone was using or shoved one in front of
someone who never asked for it.

## Solution

Whether the panel is showing moves to the module, joining the shell set and the
active tab. The height stays with the window: it is layout geometry, and a
module switch must not resize the workspace.

* `panelStore` holds `openModules` keyed by module id rather than one `open`.
  Its open/close/toggle actions take the module they act on.
* Reads come in three shapes so no caller has to re-derive the module:
  `useTerminalPanelOpen()` for React, `isTerminalPanelOpen()` for the navigation
  zone cycle (which resolves the selected module itself), and
  `isTerminalPanelOpenIn(moduleId)` for callers already holding one.
* Persistence follows the `activeShellMemory` precedent: a module-keyed,
  debounced, LRU-capped record under its own versioned key
  (`studio.terminalPanelOpen:v1`) in `panelOpenMemory`. The window's furniture
  key keeps the height (and the T726 size mode) alone.
* No migration. A window-wide flag maps onto no particular module, so a legacy
  record's height is read and its stale `open` is dropped; a module nobody has
  opened the panel in simply starts closed.

The navigation zone needed no new handoff: selecting a module already lands the
cycle in Stories, so it never points at a panel that just disappeared.

## Testing

One new case in the Studio overhaul acceptance gate — the seam T650 already
named for this territory — asserting what a person observes: opening the panel
in one module leaves another module's closed, each module keeps its own answer
across a switch, a restart returns every module to the state it was left in, and
the window's furniture record is untouched by any of it.

Case 102 (panel furniture) was narrowed to the height alone, and case 98 (module
switch) now opens the panel in the module it switches to, because reaching a
module's shell strip is a per-module gesture.
