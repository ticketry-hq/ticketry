# 02 — TabStrip and Tab, applied to the header module tabs

**Parent:** Shared UI component library for Studio (`../spec.md`)
**Blocked by:** 01
**Status:** ready-for-agent
**LLD:** `02-tabstrip-header-module-tabs/LLD.md` (+ `LLD.html`)

**What to build:** A shared `TabStrip` and `Tab` (`role="tablist"`/`tab`, roving tabindex, arrow keys, active tab scrolled into view, hidden-scrollbar overflow, leading and trailing slots, optional close per tab, drag-source passthrough, `DropSeam`). The header module selector moves onto it with the `underline` variant. The hard-coded `#7aa2f7` underline becomes a theme token. `ModulesPaneToggle` uses `useGlobalShortcutLabel` instead of its hand-rolled `useSyncExternalStore` copy.

**Instances:**
- `app/shell/ticket-workspace/ModuleTabStrip.tsx:94-135` (strip, scroller, hide-tab fallback, scrollIntoView).
- `app/shell/ticket-workspace/ModuleTab.tsx:38-91` (tab, hover close, drop seam, `ModuleLifecycleChicklets`, `ModuleJumpBadge`).
- `app/shell/ticket-workspace/ModulesPaneToggle.tsx:10-23` (duplicates `app/navigation/useGlobalShortcutLabel.ts`).
- `features/module-tabs/ModuleJumpBadge.tsx:13` (should use `KeyBadge` from `shared/ui/KeyChordHint`).
- `ModulePicker` stays as the trailing slot here; its internals move in 08.

- [ ] `shared/ui/TabStrip.tsx` (with `Tab`) exists, with `underline` implemented and the variant union declared for `boxed`, `plain`, `pill` and `rail`.
- [ ] Test: arrow keys move focus and selection, Enter/Space selects, close button does not select, active tab scrolls into view.
- [ ] Header module tabs render through `TabStrip`; hide, reorder by drag, jump badge and lifecycle chicklets behave as before.
- [ ] No `#7aa2f7` literal remains in the tab or footer toggle; the token lives in `tailwind.config.ts`.
- [ ] Typecheck, studio tests and `test:overhaul` pass.
