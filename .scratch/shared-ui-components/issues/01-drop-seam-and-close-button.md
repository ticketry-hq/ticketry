# 01 — DropSeam and CloseButton

**Parent:** Shared UI component library for Studio (`../spec.md`)
**Blocked by:** None — can start immediately.
**Status:** ready-for-agent
**LLD:** `01-drop-seam-and-close-button/LLD.md` (+ `LLD.html`)

**What to build:** All five drag-and-drop insertion seams render through one `DropSeam` (horizontal or vertical, near or far edge). Every "×" close affordance renders through one `CloseButton` (sizes `chip` and `panel`, required accessible label). Users see an identical seam and close target everywhere.

**Instances** (paths relative to `studio/src`):
- Seams: `app/shell/ticket-workspace/ModuleTab.tsx:63-73`, `app/shell/ticket-workspace/selected-ticket/internal/WorkspaceTab.tsx:78-87`, `app/shell/sidebar/modules/ModuleRow.tsx:51-60`, `app/shell/ticket-workspace/tasks/TasksPane.tsx:414-420`, `app/shell/ticket-workspace/tasks/components/StateHeaderRow.tsx:77-82`.
- Panel close (identical class): `app/modal/ModalShell.tsx:135`, `features/studio/modals/SettingsModal.tsx:451`, `features/settings/instant/ConversationConfigurationPanel.tsx:22`, `features/workflows/StateConfigurationPanel.tsx:131`.
- Chip/tab close: `ModuleTab.tsx:83`, `WorkspaceTab.tsx:97`, `features/terminal-panel/ShellTabStrip.tsx:66`, `features/workflows/StageSkillsField.tsx:41`, `features/workflows/StateCatalog.tsx:340`.

- [ ] `shared/ui/DropSeam.tsx` and `shared/ui/CloseButton.tsx` exist with behaviour tests.
- [ ] All instances above use them; no inline seam or "×" markup remains in those files.
- [ ] Every `CloseButton` has an `aria-label`; existing test ids are preserved.
- [ ] `npm run typecheck`, `npm run test --workspace @worktracker/studio` and `npm run test:overhaul` pass.
