# 06 — TextField, TextArea and Select

**Parent:** Shared UI component library for Studio (`../spec.md`)
**Blocked by:** None — can start immediately.
**Status:** ready-for-agent
**LLD:** `06-text-field-and-select/LLD.md` (+ `LLD.html`)

**What to build:** One input style (border plus focus-border on `focus-accent`, optional `mono`) for `TextField`, `TextArea` and `Select`. It replaces the ring-style inputs, the hand-rolled bordered inputs and `SETTINGS_FIELD_CLASS`. Checkboxes use `SETTINGS_CHECKBOX_CLASS`, or a `Checkbox` if the LLD finds more than one caller.

**Instances:**
- Constant to absorb and delete: `SETTINGS_FIELD_CLASS` in `shared/ui/SettingsPrimitives.tsx` (8 files).
- Bordered: `app/shell/ticket-workspace/selected-ticket/details/ChildIssues.tsx:67,85`, `features/studio/modals/KeyboardShortcutsModal.tsx:124`, `features/studio/modals/ParentUpdate.tsx:133`, `features/module-tabs/ModulePicker.tsx:214`, `app/shell/DialogHost.tsx:85` (`focus:border-accent-primary`), `features/conversations/composer/ConversationComposer.tsx:99`, `features/agents/worktrees/changes/MergeDestinationPicker.tsx:60`.
- Ring style: `features/studio/modals/AddProject.tsx:56,67`, `features/studio/modals/AddModule.tsx:186`, `features/agents/terminal/PromptInput.tsx:74`, `features/agents/terminal/ModuleFolderSelection.tsx:113`.
- Textareas: `features/documents/DescriptionEditor.tsx:173`, `features/documents/MarkdownDocumentEditor.tsx:176`.
- Hand-styled selects: `DialogHost.tsx:81`, `ChildIssues.tsx:62`, `ConversationComposer.tsx:93`.
- Checkbox: `app/onboarding/OnboardingProviders.tsx:212`.

- [ ] Components exist with tests (label association, disabled, forwarded ref, `aria-invalid` styling).
- [ ] All instances migrated; `SETTINGS_FIELD_CLASS` deleted.
- [ ] Description editor focus behaviour unchanged (see commit b47afeb0 "preserve description focus").
- [ ] Typecheck, studio tests and `test:overhaul` pass.
