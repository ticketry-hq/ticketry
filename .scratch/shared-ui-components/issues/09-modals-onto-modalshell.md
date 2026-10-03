# 09 — Modals onto ModalShell and ConfirmDialog

**Parent:** Shared UI component library for Studio (`../spec.md`)
**Blocked by:** 01, 05
**Status:** ready-for-agent
**LLD:** `09-modals-onto-modalshell/LLD.md` (+ `LLD.html`)

**What to build:** Every scrim-and-card dialog uses `ModalShell` (focus trap, Escape, focus return) or `ConfirmDialog`. The two identical full-pane configuration overlays share one `PaneOverlay`.

**Instances:**
- `features/studio/modals/SettingsModal.tsx:385-458` (`SettingsFrame`; copied `FOCUSABLE` at :56 and focus trap :393-421).
- `features/workflows/StateCatalog.tsx:120-127` (delete confirm; no focus trap or Escape).
- `features/workflows/WorkflowImpactDialog.tsx:27-35` (confirm; no focus trap or Escape).
- `app/modal/ModalErrorBoundary.tsx:62`, `app/modal/ModalHost.tsx:45-51` (scrim copies; decide whether they keep their own because they wrap ModalShell failures).
- Overlays: `features/settings/instant/ConversationConfigurationPanel.tsx:9-25`, `features/workflows/StateConfigurationPanel.tsx:118-134`.
- Shared parts: `app/modal/ModalShell.tsx`, `app/shell/DialogHost.tsx:10` (`ConfirmDialog`).

- [ ] No copy of `FOCUSABLE` or a focus-trap loop outside `ModalShell`.
- [ ] StateCatalog and WorkflowImpactDialog close on Escape and trap focus (test).
- [ ] `PaneOverlay` exists and both overlays use it.
- [ ] Typecheck, studio tests and `test:overhaul` pass.
