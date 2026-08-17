# T650 — Bottom terminal panel

Status: Spec complete
Story: WorkTracker #650 (`5d9d7e05-772d-4622-87b2-103d61debd6e`)
Date: 2026-08-15
Related decisions: [Grill decisions](DECISIONS.md)

## Problem Statement

Every terminal in Studio is agent-backed. A terminal tab *is* an agent run, and
every launch path — including the taskless Plan and Instant runs of a module
scratch workspace — requires choosing a provider and writing a prompt. There is
no way to obtain a plain interactive shell.

So ordinary command-line work leaves the application. Checking git status,
starting a dev server, inspecting a build, or running a one-off script means
switching to a separate terminal program and navigating by hand to the same
module folder Studio already holds and already spawns durable terminal sessions
in. The information and the machinery are both present; only the surface is
missing.

The gap is felt most in the loop this application exists to support. A person
reviewing what an agent just did wants to run the test suite themselves, in the
same repository, without losing sight of the work item — and today that is the
one thing the workspace cannot offer them.

## Solution

Studio gains a **terminal panel**: a collapsible surface along the bottom of the
ticket workspace that hosts plain interactive shells for the selected module.

It is a shell surface, not a dock. Agent runs keep their terminal tabs in the
task workspace exactly as they are; the panel never shows one. A terminal tab
remains an agent run, with everything that depends on that — the live-terminal
cycle, subtree lifecycle chicklets, per-work-item active tab memory — untouched.

Each shell is a **shell run**: a run with no agent, whose durable terminal
session hosts a login shell in the module folder. It reuses the existing
terminal runtime, transport, viewer ownership and native renderer without
changing any of them, because all four already treat a run's identity as opaque.

The panel spans the Stories and workspace panes and leaves the sidebar full
height, so its extent matches its module scope. `Ctrl+\`` opens it and closes
it. It carries its own tab strip: several **panel shell tabs** per module, one
visible at a time. Whether the panel is open and how tall it is belong to the
window and persist across restarts; which shells a module has and which is
active belong to the module.

Shells are durable. They survive an app restart or a sidecar rebuild, so a dev
server started in one is still running when the application comes back. Nothing
attaches until the panel is opened — the durable sessions live on regardless of
whether anyone is looking at them.

## User Stories

1. As a developer working in a module, I want a plain shell in that module's
   folder without choosing a provider or writing a prompt, so that ordinary
   command-line work does not require leaving Studio.
2. As a developer, I want a single keystroke to open the panel and put me in the
   shell, so that reaching a terminal is not a task in itself.
3. As a developer, I want that same keystroke to close the panel from wherever
   focus is, so that the gesture reverses itself predictably.
4. As a developer typing in an agent's terminal, I want the panel toggle to
   still work, so that the shortcut is not swallowed by terminal typing mode.
5. As a developer, I want several shells in one module, so that a long-running
   dev server does not block me from typing a git command.
6. As a developer, I want to create a new shell from the panel itself, so that
   adding one does not send me elsewhere in the interface.
7. As a developer opening an empty panel, I want a shell to be there already, so
   that the common case costs no extra action.
8. As a developer, I want to close a shell I am finished with, so that the tab
   strip reflects what I am actually using.
9. As a developer, I want my shells to survive an app restart or a sidecar
   rebuild, so that a routine reload does not kill a long-running process.
10. As a developer switching module tabs, I want that module's own shells, so
    that a shell is always rooted in the repository I am looking at.
11. As a developer, I want the panel's height where I left it, so that I do not
    resize it every session.
12. As a developer, I want the panel's open state remembered across restarts, so
    that the application returns in the layout I work in.
13. As a developer returning to a module, I want the shell I last used to be the
    active one, so that I resume where I stopped.
14. As a developer, I want to resize the panel vertically, so that I can trade
    terminal height against the work item I am reading.
15. As a keyboard user, I want to reach the panel through the navigation zone
    cycle, so that a visible surface is not unreachable without a mouse.
16. As a keyboard user, I want to leave the shell without closing the panel, so
    that stepping away from typing does not discard my layout.
17. As a developer whose command crashed the shell, I want the tab to remain
    with its exit code, so that I can read what failed.
18. As a developer who typed `exit`, I want the tab to close, so that finished
    shells do not pile up.
19. As a developer looking at a failed shell, I want to restart it in place, so
    that recovering does not mean rebuilding my tab layout.
20. As a developer on a module with no module folder configured, I want to be
    told rather than silently placed somewhere else, so that I never operate on
    the wrong directory without knowing.
21. As a developer on a module with no module folder, I want the folder picker
    offered where the terminal would be, so that fixing it is immediate.
22. As a developer whose module folder was deleted or moved, I want the same
    treatment as a missing one, so that a stale path cannot mislead me.
23. As a developer running an agent and a shell at once, I want both visible
    together, so that I can watch what the agent does while I check it.
24. As a developer, I want typing to go to whichever terminal I chose, so that
    two visible terminals never compete for my keystrokes.
25. As a developer using the browser build, I want the panel to work there too,
    so that development mode is not a reduced surface.
26. As a developer, I want the panel to cost nothing while closed, so that
    keeping it shut is a real way to keep the application light.
27. As a developer with many modules, I want shells only where I made them, so
    that unused modules carry no hidden processes.
28. As a maintainer, I want shells excluded from agent activity counts, so that
    module badges and chicklets keep meaning what they say.
29. As a maintainer, I want a shell ending to advance no campaign, so that
    closing a terminal cannot disturb scheduled work.
30. As a maintainer, I want shells to leave agent-run launch, lifecycle and
    reconciliation semantics unchanged, so that this surface adds no risk to the
    one the product depends on.

## Implementation Decisions

### Domain

* A shell run is recorded as a run with a dedicated shell scope and **no
  agent**. It hangs off the module's own work item, with the scratch task
  sentinel in place of a task — the shape taskless scratch runs already use,
  valid because a module is itself a work item.
* The run's agent becomes optional. The run already carries a scope that is
  documented as its own durable routing discriminator, so no second
  discriminator is introduced.
* The glossary keeps **two terms for one record**: an agent run means what it
  always did, and a shell run is its own term. No umbrella term is invented, so
  the divergence between the code's spelling and the domain's vocabulary stays
  explicit. Recorded as an ADR in the terminals context.

### Backend

* Shell launch is its own entry point beside agent launch, not a branch inside
  it. It resolves no adapter, builds no prompt, resolves no skills and reads no
  launch configuration; it produces a login-shell command and a working
  directory. The shell inherits the ordinary launch environment minus the
  agent-specific variables, since a shell has no hooks to report with.
* The working directory is the profile's module folder. If the module has no
  folder, or the configured path is not a directory, the launch is **refused**.
  This deliberately diverges from agent launch preflight, which falls back to
  the home directory — a bare shell cannot explain itself the way a prompt can,
  and a shell that appears to be in your repository but is not fails silently
  and destructively.
* The terminal runtime, durable session naming, transport and viewer ownership
  are unchanged. They already treat a run's identity as an opaque handle.
* Reconciliation reads a shell run's hosted-command exit as "the shell ended",
  not as an agent-run outcome, and retains the exit code for presentation.
* Ending a shell run announces itself on the run completion seam like any run.
  This is a verified no-op for the subtree scheduler, which resolves runs to
  scheduled work and finds none; no guard is added, but any future subscriber
  must tolerate runs that nothing scheduled.

### Studio

* The panel is a vertically resizable region nested inside the ticket workspace,
  below the existing Stories/workspace split. New code lives in its own feature
  folder rather than growing the agent terminal feature, whose vocabulary is
  agent runs.
* The shell viewer reuses the existing terminal component and native viewer
  machinery unchanged, including the fallback selection between the native
  renderer and the browser renderer.
* The panel toggle is a binding registered in the **capture** keymap context, so
  it resolves ahead of terminal typing mode — which otherwise intercepts only
  the typing-mode exit chord. The chosen chord is currently unbound.
* Toggle semantics are strictly two-state: closed opens the panel and focuses
  the active shell; open closes it regardless of where focus sits.
* The panel is a fourth navigation zone in the edit view's zone cycle. Entering
  it commits to terminal typing mode; the typing-mode exit chord leaves typing
  without closing the panel.
* Persistence follows the client store's existing split: a versioned global key
  for the open flag and the height, a per-module keyed record for the shell set
  and the active tab, with debounced writes. This is the same division the store
  already draws between window furniture and per-module content.
* Opening a panel with no shells for the current module creates the first one.
  Shells attach a viewer only while the panel is open; entering a module is not
  enough.
* A module with no valid module folder renders the existing module-folder
  selection affordance in place of a terminal.
* Shell count is capped per module.

### Presentation

* At most one shell is presented at a time, so at most one additional native
  view exists beyond the workspace's. Viewer ownership claims are keyed by run
  and a shell run is never an agent run, so claims cannot collide and no new
  ownership role is introduced.

## Testing Decisions

A good test here asserts what a person can observe: that a keystroke reveals a
terminal, that a tab survives a reload, that a refusal is visible, that a count
does not move. It never reaches for a store's internals, a component's private
state, or the shape of a persisted record. Where a decision was made *because*
something must not regress silently, the test asserts the absence directly
rather than trusting that an existing filter keeps holding.

Two existing seams, no new ones.

**Studio overhaul acceptance gate.** Everything user-visible. This gate is the
highest seam in Studio, drives the real interface against fakes, and is the
established prior art for precisely this territory — it already pins dead
terminal tabs after external kills, dismissal surviving reconciliation, resume
into a new tab, native viewer preparation and reveal ordering, ownership release
on detach, viewer retention, and terminal activity reporting while hidden. New
cases are appended as numbered rows in the acceptance document alongside their
tests. Cases to add:

* Toggle opens the panel with a shell in the module folder and focuses it;
  toggling again closes it from any focus position.
* The toggle resolves while an agent terminal holds terminal typing mode — the
  reason the binding is capture-context.
* A module with no valid module folder refuses a shell and offers the
  module-folder affordance instead of a terminal.
* Several shells coexist in one module, one visible at a time; switching modules
  swaps the set and restores the previously active tab.
* Open state and height survive a reload; the shell set and active tab are
  restored per module.
* A clean exit disposes the tab; a non-zero exit retains it with its code and
  offers a restart that produces a new shell run.
* No viewer attaches while the panel is closed.
* An agent terminal and a shell are visible together and keystrokes reach only
  the chosen one.
* A shell run moves no agent activity count — module badge, scratch chicklets,
  subtree chicklets — and is not a stop in the live-terminal cycle. This
  currently falls out of existing scope and task filters rather than explicit
  guards, so it would regress silently and must be pinned deliberately.

**Backend terminals application-service seam.** Everything the Studio gate can
only see through a fake. Prior art is this seam's existing launch-persistence
and reconciliation coverage, including its guard tests asserting the services
depend on the public runtime protocol rather than on tmux or models — new tests
must preserve that property. Cases to add:

* Shell launch persists run and terminal records together and compensates both
  on failure, matching the existing agent-launch guarantee.
* Shell launch resolves no adapter, builds no prompt and reads no launch
  configuration.
* Shell launch is refused when the module folder is absent or is not a
  directory, and no partial runtime survives the refusal.
* A shell run carries the module as its work item and the scratch sentinel as
  its task.
* Reconciliation records a shell's hosted-command exit and its exit code without
  interpreting it as an agent-run outcome.
* Ending a shell run announces on the completion seam and advances no campaign.

The wire contract test is extended with the new scope and the optional agent
rather than duplicated into a third seam.

## Out of Scope

* **Terminal splits.** One visible shell at a time is a deliberate bound on
  simultaneously presented native views, which is the part of the native stack
  that has historically been hardest to keep correct.
* **Moving agent terminal tabs into the panel.** The panel is a shell surface.
  Turning it into a dock that hosts agent runs too is a workspace
  re-architecture and remains a possible later move, not this one.
* **Tab labels naming the running subprocess** — showing the running command
  rather than the shell. A good follow-up; it needs a metadata channel that does
  not exist yet.
* **Selecting terminal output into an agent prompt.**
* **Any change to agent-run launch, lifecycle, reconciliation semantics, or the
  existing terminal tab experience.**
* **Renaming the run record.** Generalizing its name to match its widened
  meaning was considered and rejected in favour of two glossary terms.

## Further Notes

T3 Code, checked out locally beside this repository, ships the same product
surface on the same terminal library and is worth reading before implementing.
Four of its choices differ deliberately from those taken here: its terminal ids
are client-chosen rather than server-allocated; its sessions are server-owned
PTYs whose *transcript* rather than process is what survives; its panel state
including height is keyed per thread rather than split between window and
module; and it separates a lightweight terminal metadata stream from the byte
stream so a tab strip need not attach to every terminal. That last idea is the
one most worth revisiting here if the panel ever outgrows a handful of shells,
and it is also what a subprocess-aware tab label would need.

**The largest risk in this ticket is not the panel.** Making the run's agent
optional touches every reader of that field across the backend, the wire
contract and the Studio type surface. That change should be sequenced first,
landed on its own, and verified independently before any panel work begins.

The second risk is quieter. A shell run is excluded from every agent activity
surface today only because existing filters happen to match on scope or on a
real task id, and because activity counts are driven by lifecycle state that
arrives from agent hooks a shell does not have. Nothing declares that exclusion.
If a future change starts counting runs by module alone, shells will silently
appear in badges — which is why the acceptance gate pins it.
