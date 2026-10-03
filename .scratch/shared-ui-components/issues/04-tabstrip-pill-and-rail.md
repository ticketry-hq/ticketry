# 04 — TabStrip pill and vertical-rail variants

**Parent:** Shared UI component library for Studio (`../spec.md`)
**Blocked by:** 02
**Status:** ready-for-agent
**LLD:** `04-tabstrip-pill-and-rail/LLD.md` (+ `LLD.html`)

**What to build:** The workflows pill tabs, the Settings side rail and the pressed footer and changes toggles use `TabStrip` variants `pill` and `rail`, or the exported tab-look toggle button. The two byte-identical pill class pairs disappear.

**Instances:**
- Pill tablists: `features/workflows/IssueTypesSection.tsx:85-104`, `features/workflows/StateConfigurationPanel.tsx:223-241`.
- Rail: `features/studio/modals/SettingsModal.tsx:99-130, 350-383` (`RailItem`; Up/Down keys).
- Pressed toggles: `app/shell/FooterChangesToggle.tsx:50-58` (underline look, `aria-pressed`), `features/agents/worktrees/changes/ChangesToolbar.tsx:176-179`.

- [ ] `pill` and `rail` variants are implemented and tested (rail uses Up/Down).
- [ ] All instances migrated; `RailItem` deleted.
- [ ] Toggles keep `aria-pressed` semantics, not `role="tab"`.
- [ ] Typecheck, studio tests and `test:overhaul` pass.
