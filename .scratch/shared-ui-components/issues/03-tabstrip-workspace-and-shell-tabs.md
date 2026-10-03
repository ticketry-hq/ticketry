# 03 — TabStrip for workspace and shell tabs

**Parent:** Shared UI component library for Studio (`../spec.md`)
**Blocked by:** 02
**Status:** ready-for-agent
**LLD:** `03-tabstrip-workspace-and-shell-tabs/LLD.md` (+ `LLD.html`)

**What to build:** The selected-ticket workspace tabs (`boxed` variant) and the terminal panel shell tabs (`plain` variant) render through `TabStrip`, keeping close, "+" and drag-and-drop reordering. They lose their copied scroller, seam and close markup.

**Instances:**
- `app/shell/ticket-workspace/selected-ticket/internal/WorkspaceTab.tsx:16-105`, `WorkspaceTabStrip.tsx:122-140` (copies ModuleTab's hidden-scrollbar scroller at :137).
- `features/terminal-panel/ShellTabStrip.tsx:25-86`.
- `DormantWorkspaceTabs` and `WorkspaceLauncher` anchor to the closest `[role=tablist]`; keep that anchor working (their menus move in 07).

- [ ] Both strips use `TabStrip`; `boxed` and `plain` variants are implemented and tested.
- [ ] Workspace tab drag-reorder, close and shell add/close behave as before; terminal acceptance tests pass unchanged.
- [ ] Typecheck, studio tests and `test:overhaul` pass.
