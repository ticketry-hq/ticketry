# 07 — Menu and Listbox on Popover, with a shared arrow-key hook

**Parent:** Shared UI component library for Studio (`../spec.md`)
**Blocked by:** None — can start immediately.
**Status:** ready-for-agent
**LLD:** `07-menu-listbox-on-popover/LLD.md` (+ `LLD.html`)

**What to build:** `Popover` gains Escape dismissal and flip-when-no-room (if missing). `Menu` (`role="menu"`) and `Listbox` (`role="listbox"`, `aria-activedescendant`) are built on it, sharing one keyboard-navigation hook (Up/Down, Home/End, Enter). `PopoverOption` is the single option row with one size and one active style. The action menus move onto `Menu`.

**Instances (this ticket):**
- `app/shell/ticket-workspace/selected-ticket/details/IssueActionsMenu.tsx:26-44,71-73,94,105` (mousedown + Escape, absolute, "⋯").
- `features/agents/worktrees/WorktreeBlock.tsx:344-354` (already on Popover; "⋯" trigger).
- `app/shell/ticket-workspace/selected-ticket/internal/DormantWorkspaceTabs.tsx:33-35,69-112` (fixed + portal, anchored below `[role=tablist]`).
- `app/shell/ticket-workspace/selected-ticket/internal/WorkspaceLauncher.tsx:110-175,309` (ResizeObserver + flip).
- Existing Popover callers to keep working: `WorkflowStatePicker.tsx`, `details/fields/{Blocker,IssueType,Parent,State}Picker.tsx`.
- Duplicate private `Dot` in `fields/StatePicker.tsx:21` and `WorkflowStatePicker.tsx:36`, and duplicate "No permitted transitions" rows at `:62`/`:84`: leave for 10/11, but do not add new copies.

- [ ] `shared/ui/Menu.tsx`, `shared/ui/Listbox.tsx` and the navigation hook exist; tests cover Escape, outside click, Up/Down/Home/End/Enter, and focus return to the trigger.
- [ ] The four menus above use `Menu`; their hand-rolled dismiss and positioning code is deleted.
- [ ] Floating panel surface is one style (`Popover`'s).
- [ ] Typecheck, studio tests and `test:overhaul` pass.
