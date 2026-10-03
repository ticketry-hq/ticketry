# 08 — Search pickers on Listbox

**Parent:** Shared UI component library for Studio (`../spec.md`)
**Blocked by:** 07
**Status:** ready-for-agent
**LLD:** `08-search-pickers-on-listbox/LLD.md` (+ `LLD.html`)

**What to build:** The module picker ("+" in the header), worktree switcher and merge destination picker become `Popover` + `PopoverSearch` + `Listbox`. They drop three hand-written keyboard loops, two absolute-positioned panels and one blur-based dismissal.

**Instances:**
- `features/module-tabs/ModulePicker.tsx:41-259` (outside pointerdown :69-82, anchoring copy :84-104, keyboard :147-169, options :223-247, own search input :214).
- `features/agents/worktrees/changes/WorktreeSwitcher.tsx:57-94,147,161` (mousedown, absolute, `shadow-2xl`).
- `features/agents/worktrees/changes/MergeDestinationPicker.tsx:60-109` (blur dismiss, `bg-white/10` active, `bg-pane-bg` panel).
- "▾" trigger suffix copies: `WorkflowStatePicker.tsx:75`, `WorktreeSwitcher.tsx:122`, `MergeDestinationPicker.tsx:92`, `DormantWorkspaceTabs.tsx:167`; decide whether the trigger is a `Button` slot.

- [ ] All three pickers use `Listbox`; keyboard, filtering and selection behave as before.
- [ ] No hand-rolled outside-click, positioning or arrow-key code remains in these files.
- [ ] Typecheck, studio tests and `test:overhaul` pass.
