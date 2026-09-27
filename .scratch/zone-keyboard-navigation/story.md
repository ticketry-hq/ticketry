# Story — Zone-based keyboard navigation

Publish as one **Story** in the installation project, with the nine
**Implementation** tickets below as its children. Create them in order (01 → 09)
so each ticket's blockers exist first, and record the blockers as native
blocked-by relationships.

---

## Problem Statement

Studio's keyboard navigation works, but it cannot grow. The edit view's
navigation zones, terminal typing mode, the full sidebar view's focused pane,
modals, and global actions each follow their own rules. Which keymap context
wins is decided by hand-written branches in one dispatcher rather than by a
model. Entering and leaving terminal typing mode is hardwired to Enter and
Cmd+Esc: neither can be rebound, and components cannot trigger them. Adding a
new surface with its own keys, such as sections inside Story details, means
editing a central switch and relearning every special case. A typo in an action
id silently disables a shortcut.

## Solution

Every keyboard surface becomes a **navigation zone** on one **zone stack**. A
key is resolved in one fixed way: reserved chords first, then the active zone
stack from the innermost zone outward, ending at a root zone that holds global
actions. Features declare their own zones next to the UI they render. Entering
and leaving a zone are named actions (`zone.enter`, `zone.exit`) with bindings
users can rebind, and components can call them directly. Terminal typing mode,
modals, the edit view zones, and the full sidebar view panes all become zones in
this one model.

## User Stories

1. As a keyboard user, I want Shift+Tab to cycle the edit view's navigation zones exactly as today, so that the refactor changes nothing I rely on.
2. As a keyboard user, I want to enter a terminal with a named "enter zone" action, so that the gesture is consistent everywhere.
3. As a keyboard user, I want to leave terminal typing mode with a named "exit zone" action, so that I always have one known way out.
4. As a keyboard user, I want to rebind "enter zone" and "exit zone" in Keyboard settings, so that they don't clash with keys my shell or agent needs.
5. As a pointer user, I want clicking into a terminal to enter it, so that the mouse and keyboard leave Studio in the same state.
6. As a pointer user, I want closing or blurring an entered surface to exit it, so that Studio never believes I'm still typing in a terminal I've left.
7. As a desktop user, I want my rebound exit chord to work inside the native terminal, so that rebinding doesn't strand me in typing mode.
8. As a keyboard user, I want reserved chords (exit zone, terminal panel toggle, Cmd+1..0, settings) to work from any zone, including an entered terminal, so that no zone can trap me.
9. As a keyboard user, I want single-key global actions (o, n, s, /, ?, q) to keep working when no zone claims the key, so that global commands stay reachable.
10. As a keyboard user, I want single-key global actions to be ignored while I'm typing in a text field, so that typing "s" never opens status.
11. As a keyboard user, I want an open modal to receive keys first and block everything beneath it, so that background shortcuts never fire behind a dialog.
12. As a keyboard user, I want Escape to always close the top modal, so that I always have a way out of a dialog.
13. As a keyboard user in the full sidebar view, I want pane navigation to keep working, so that both layouts behave predictably.
14. As a keyboard user, I want the shortcut legend (?) to show the bindings in effect on the current zone stack, innermost first, so that what I read is what fires.
15. As a Studio developer, I want to declare a zone and its actions beside the component that renders it, so that adding keyboard support doesn't touch a central router.
16. As a Studio developer, I want action ids to be compile-checked, so that renaming or mistyping one fails the typecheck instead of silently disabling a shortcut.
17. As a Studio developer, I want a duplicate zone id to fail loudly in development, so that two components can't fight over one zone.
18. As a Studio developer, I want a test that flags a chord bound at two levels of a zone stack unless the shadowing is marked intentional, so that accidental conflicts are caught before merge.
19. As a Studio developer, I want to nest a zone inside another (e.g. sections inside Story details) without new concepts, so that deeper keyboard navigation can be added later.

## Implementation Decisions

- **Zone stack.** One ordered stack of active zones, e.g. `root → edit-view → details → terminal`. Only zones on the stack receive keys. A mounted zone that is not on the stack receives nothing, so sibling zones cannot conflict.
- **Resolution order (fixed, not configurable):**
  1. Reserved chords: exit zone, terminal panel toggle, module position jumps, settings.
  2. The zone stack, innermost first. The first zone whose declared action matches claims the key and resolution stops.
  3. The root zone (global actions) at the bottom of the stack. It is skipped when the event target is a text-entry element.
- **Innermost wins.** Overlapping bindings are always parent/descendant, and the child shadows the parent on purpose. Intentional shadowing is declared (`overrides`) so the static check can tell it apart from accidents.
- **Modals are zones that block fall-through.** Opening a modal pushes a blocking zone; zones beneath it never see keys. Escape stays a hardcoded escape hatch for the top modal.
- **Enter and exit are actions, not keys.** `zone.enter` and `zone.exit` are ordinary bindings with defaults Enter and Cmd+Esc. `zone.exit` is reserved so an entered zone that claims every key can still be left. The zone stack API is shared by keyboard and components:
  ```ts
  zoneStack.enter(zoneId)   // push a child zone
  zoneStack.exit()          // pop to the parent
  ```
- **Each zone declares what entering means** (a static child zone id, or a function for dynamic targets). A zone that declares nothing makes `zone.enter` a no-op there. A zone may bind its own action to the enter chord (e.g. Stories uses Enter to activate the selected Story); innermost-wins lets that shadow `zone.enter`.
- **An entered terminal is a zone that claims every key**, which replaces the separate "body engaged" flag. The stack is the only record of whether Studio is in terminal typing mode.
- **Zones declare action ids up front** rather than handling raw events inline, so the registry can render the legend and the shadowing check can walk every stack.
- **Keymap contexts collapse into the model:** `modal` → blocking modal zone; `capture` → reserved chords; `focused-pane` and the edit view zone switch → zones; `global` → root zone. Chord storage and binding overrides (host-level, overrides only) are unchanged.
- **Action ids become a compile-checked type** derived from the default binding table.
- **Native terminal (desktop).** The host is told the current `zone.exit` and reserved chords instead of hardcoding them, and reports `zone.exit` in place of `body-disengage`.
- **ADR.** A new ADR supersedes the precedence order in ADR 0001 (central keymap registry) and amends ADR 0003 (edit view modal zone navigation): terminal typing mode becomes an entered zone, and Enter and Cmd+Esc become default bindings rather than fixed keys. Update the CONTEXT.md glossary entries for Keymap context, Navigation zone, Navigation mode, Terminal typing mode, and Reserved chord.

## Testing Decisions

- A good test drives real key presses and asserts what the user sees (selection, focus ring, open surface). It does not assert on internal stack contents or handler calls.
- **Primary seam:** keyboard acceptance tests on the mounted Studio shell. The existing edit view navigation, terminal panel zone, terminal navigation, and native chord acceptance suites are prior art, and they must stay green unchanged through every ticket.
- **One new unit seam:** the zone stack resolver in isolation. It covers innermost-wins, reserved chords first, modal blocking, the root zone being skipped in text fields, `zone.enter` / `zone.exit`, and the duplicate-id error.
- **Static shadowing check:** walks every reachable zone stack and fails on a chord bound at two levels without `overrides`.

## Out of Scope

- Merging the two modal stores into one.
- New nested zones inside Story details (the model supports them; building them is a follow-up).
- Multi-key sequences or alternate chords per action.
- Changing any default chord other than making Enter and Cmd+Esc rebindable.
- Deciding whether the full sidebar view should keep its own navigation model (product question).

## Further Notes

The zone model was designed in conversation. It is a strict generalisation of
ADR 0003's three-zone model, so every behaviour that ADR guarantees must survive.

---

## Implementation tickets

### 01 — Compile-checked action ids and keymap registry cleanup

**What to build:** Action ids become a type derived from the default binding table, so routes that switch on an action id fail the typecheck when an id is mistyped or renamed. Remove the registry's dead installation-availability check and the duplicated candidate-chord matching and effective-binding listing. No user-visible change.

**Blocked by:** None — can start immediately.

- [ ] Every action id comparison in navigation routing is typed; a misspelt id fails `npm run typecheck`
- [ ] Registry duplicate logic removed; behaviour unchanged
- [ ] All existing keyboard acceptance suites pass unchanged

### 02 — Zone stack with enter/exit actions, proven on terminal typing mode

**What to build:** Introduce the zone stack, the reserved-chord layer, and the shared `zoneStack.enter()` / `exit()` API. Terminal typing mode (active tab body and terminal panel) runs on it: entering a terminal by keyboard (`zone.enter`) or by clicking into it pushes the terminal zone; `zone.exit`, closing it, or blurring it pops the zone. Enter and Cmd+Esc become the rebindable defaults for these actions in Keyboard settings. The separate "body engaged" flag is removed.

**Blocked by:** 01

- [ ] Enter on a focused terminal body enters typing mode; Cmd+Esc leaves it in place, exactly as today
- [ ] Clicking into a terminal enters typing mode; the exit action returns to navigation mode with the focus ring restored
- [ ] Rebinding `zone.exit` in Keyboard settings takes effect in the browser build
- [ ] Reserved chords (panel toggle, Cmd+1..0, settings) still work from an entered terminal
- [ ] Zone stack resolver unit tests cover innermost-wins, reserved-first, and duplicate-id error
- [ ] Existing terminal and edit view acceptance suites pass unchanged

### 03 — Stories zone declares its own keys

**What to build:** The Stories pane declares its zone and actions beside its component: cursor movement, expand/collapse, Enter to activate (shadowing `zone.enter`), Shift+Enter to choose a provider, and Right to expand and dive. Its branch is removed from the central edit view router.

**Blocked by:** 02

- [ ] Stories keyboard behaviour is identical to today, including ADR 0003's act-or-exit arrows
- [ ] Stories routing no longer lives in the central navigation router
- [ ] Edit view navigation acceptance suite passes unchanged

### 04 — Tab strip and tab body zones; zone cycle driven by the zone registry

**What to build:** The tab strip and the active tab body declare their zones. Shift+Tab cycles the registered edit view zones, with the terminal panel joining only while it is open. The edit view's central zone switch is deleted.

**Blocked by:** 02

- [ ] Shift+Tab cycle order and wrapping unchanged, including the terminal panel appearing only while open
- [ ] Tab strip arrows and Enter-to-commit-and-dive unchanged
- [ ] The edit view zone switch is gone
- [ ] Edit view and terminal panel zone acceptance suites pass unchanged

### 05 — Root zone for global actions

**What to build:** Global single-key actions (open agent, plan, instant change, run now, status, search, shortcuts, toggle sidebar, set folder, close tab, open with prompt) move to a root zone at the bottom of every stack. Inner zones can shadow them. The root zone is skipped while focus is in a text field. The `global` keymap context is deleted.

**Blocked by:** 02

- [ ] Every global action fires from any zone that doesn't claim its key
- [ ] Typing any global letter in a text field types the letter and fires nothing
- [ ] An inner zone binding the same chord wins over the global action
- [ ] Existing global-shortcut acceptance coverage passes unchanged

### 06 — Modals as blocking zones

**What to build:** Opening a modal pushes a zone that blocks fall-through to everything beneath it; its declared actions (next, previous, confirm, submit) resolve inside it. Escape remains the hardcoded way to close the top modal. The dispatcher's modal special cases are deleted.

**Blocked by:** 02

- [ ] With a modal open, no background or global shortcut fires
- [ ] Modal next/previous/confirm/submit and focus trapping unchanged
- [ ] Escape closes only the top modal, and focus returns where it was
- [ ] Modal acceptance coverage passes unchanged

### 07 — Full sidebar view panes become zones

**What to build:** The full sidebar view's panes (Modules, Stories, details or terminal) become zones on the same stack, and moving between panes becomes zone navigation. The `focused-pane` keymap context and its pane-to-action table are deleted, so both layouts share one model.

**Blocked by:** 03, 05

- [ ] Pane navigation and in-pane keys in the full sidebar view are unchanged
- [ ] Switching between the full sidebar view and the edit view keeps a valid zone stack
- [ ] The `focused-pane` context no longer exists
- [ ] Full sidebar view acceptance coverage passes unchanged

### 08 — Native terminal follows the effective exit and reserved chords

**What to build:** On desktop, the native terminal host is given the current `zone.exit` and reserved chords instead of hardcoding them, and is updated when bindings change. It reports `zone.exit` in place of `body-disengage`, routed to the same zone stack exit.

**Blocked by:** 02

- [ ] After rebinding `zone.exit`, the new chord leaves an entered native terminal; the old chord no longer does
- [ ] Panel toggle, settings, and Cmd+1..0 still escape an entered native terminal
- [ ] Native chord acceptance suite passes, updated only for the renamed chord

### 09 — Stack-aware shortcut legend, shadowing check, and ADR

**What to build:** The shortcut legend shows the bindings in effect on the current zone stack, innermost first. A static check walks every reachable zone stack and fails on unintended shadowing. Any leftover keymap-context dispatch code is deleted. Record the new ADR and update the glossary.

**Blocked by:** 03, 04, 05, 06, 07

- [ ] The legend changes as the active zone changes and matches what actually fires
- [ ] The shadowing check fails when a chord is bound at two stack levels without `overrides`
- [ ] No keymap-context branching remains in the dispatcher
- [ ] New ADR supersedes ADR 0001's precedence order and amends ADR 0003; CONTEXT.md glossary updated
