# 05 — Button

**Parent:** Shared UI component library for Studio (`../spec.md`)
**Blocked by:** None — can start immediately.
**Status:** ready-for-agent
**LLD:** `05-button/LLD.md` (+ `LLD.html`)

**What to build:** One `Button` (`primary`, `secondary`, `danger`, `ghost`, `icon`, `dashed`; sizes `sm` and `md`) and a `DialogFooter` (Cancel then confirm, right-aligned). It replaces `settingsButtonClass`, the `DialogHost` button classes and every inline copy. Footer bar buttons use `ghost`.

**Instances:**
- Shared helper to absorb and delete: `shared/ui/SettingsPrimitives.tsx` `settingsButtonClass` (8 caller files).
- Third button system: `app/shell/DialogHost.tsx:5-8` (`bg-accent-primary text-white`; off-token).
- Accent primary: `app/startup/BootstrapGate.tsx:86`, `features/studio/modals/AddProject.tsx:90`, `features/studio/modals/AddModule.tsx:240`, `features/terminal-panel/ModuleFolderRequired.tsx:86`, `features/agents/terminal/PromptInput.tsx:95`, `features/agents/terminal/ModuleFolder.tsx:136`, `app/modal/NotifyUserModal.tsx:50`.
- Modal cancel: `AddProject.tsx:82`, `AddModule.tsx:232`, `ModuleFolder.tsx:128`, `PromptInput.tsx:87`.
- Secondary with hover: `app/modal/ModalErrorBoundary.tsx:83,90`, `app/startup/SettingsAccess.tsx:31`, `app/onboarding/OnboardingTour.tsx:161`, `features/terminal-panel/DeadShell.tsx:37`, `features/terminal-panel/TerminalPanel.tsx:130`, `features/workflows/StoryWorkflowGuideDialog.tsx:154`, `features/agents/terminal/XtermTerminal.tsx:127`, `NativeGhosttyTerminal.tsx:302`.
- h-7 action buttons: `app/shell/ticket-workspace/selected-ticket/details/RunNowAction.tsx:40`, `NormalRunAction.tsx:111,201`, `internal/SubtreeRunButton.tsx:33`, `fields/PickerTrigger.tsx:31`.
- Dashed triggers: `WorkspaceLauncher.tsx:287`, `DormantWorkspaceTabs.tsx:156-160`, `PickerTrigger.tsx:27`.
- Other: `features/agents/worktrees/changes/ChangesToolbar.tsx:114`; conversation prototypes `ConversationInboxVariant.tsx:318`, `ConversationTimelineVariant.tsx:141` (trivial swap only).
- Modal footers (7): AddProject, AddModule, ModuleFolder, PromptInput, DialogHost ×2, WorkflowImpactDialog.
- Footer bar: `app/shell/StudioFooterActions.tsx:30`, `features/terminal-panel/FooterTerminalToggle.tsx:43`.

- [ ] `shared/ui/Button.tsx` and `DialogFooter` exist with tests (disabled, type defaults to `button`, variant `danger` reachable).
- [ ] All instances migrated; `settingsButtonClass` and the `DialogHost` class constants are deleted.
- [ ] No `bg-accent-primary` button styling remains.
- [ ] Typecheck, studio tests and `test:overhaul` pass.
