# 10 — SectionHeading, EmptyState, LoadingState and ErrorLine

**Parent:** Shared UI component library for Studio (`../spec.md`)
**Blocked by:** None — can start immediately.
**Status:** ready-for-agent
**LLD:** `10-headings-and-placeholders/LLD.md` (+ `LLD.html`)

**What to build:** One heading component (`eyebrow`, `section` with optional count, `title`), `EmptyState` (`inline`, `pane`), `LoadingState` (`role="status"`, "…") and `ErrorLine` (`role="alert"`, `lifecycle-danger`). Every listed instance uses them. `SETTINGS_EYEBROW_CLASS` and `SETTINGS_SECTION_HEADING_CLASS` fold in, and the off-token reds go away.

**Instances:**
- Eyebrows: `SettingsModal.tsx:293`, `app/onboarding/OnboardingProviders.tsx:196`, `features/studio/modals/AddModule.tsx:172,195`, `features/agents/terminal/ModuleFolderSelection.tsx:124`, `features/settings/instant/ConversationConfigurationPanel.tsx:13`, `features/workflows/StateConfigurationPanel.tsx:122,401`, `features/studio/modals/KeyboardShortcutsModal.tsx:88,109,133`, `features/agents/worktrees/changes/BranchInspector.tsx:91`, `WorktreeSwitcher.tsx:127`, `features/documents/MarkdownDocumentEditor.tsx:148,156`, `KeyboardSettingsPanel.tsx:217`, `features/work-items/WorkItemSearchList.tsx:98` (`GroupHeading`), `DormantWorkspaceTabs.tsx:35`, `app/modal/ModalShell.tsx:127`, `ModalErrorBoundary.tsx:67`. Conversation prototypes: trivial swap only.
- Section with count: `details/ChildIssues.tsx:32-37`, `details/Attachments.tsx:12-17`, `details/FindingsPanel.tsx:38-45`, `fields/Field.tsx:25` (label).
- Titles (`text-base font-semibold text-text-primary`): `StateConfigurationPanel.tsx:222,245,311,385`, `WorkflowImpactDialog.tsx:35`, `StateCatalog.tsx:127`, `app/onboarding/CoachMark.tsx:211`.
- Inline empty: `fields/StatePicker.tsx:62`, `WorkflowStatePicker.tsx:84`, `fields/IssueTypePicker.tsx:49-51`, `ChildIssues.tsx:41`, `WorkItemSearchList.tsx:89`, `WorktreeSwitcher.tsx:161`, `MergeDestinationPicker.tsx:109`, `ModulesPane.tsx:73`, `TasksPane.tsx:457`, `SelectedTicketContent.tsx:350`, `SelectedTicketDetails.tsx:18`, `StatusUpdate.tsx:83`, `ParentUpdate.tsx:137`.
- Pane empty: `EmptyModuleWorkspace.tsx:33`, `IssueDetail.tsx:160,164`, `features/terminal-panel/DeadShell.tsx:25`, `TerminalPanel.tsx:97,123,177`.
- Loading (about 20): `features/workflows/ModelConfigurationPanel.tsx:317`, `StoryWorkflowGuideDialog.tsx:106,123`, `StateCatalog.tsx:130`, `WorktreeMergePreview.tsx:190,326`, `ChangesFileReview.tsx:170`, `SettingsModal.tsx:160`, `app/modal/ModalHost.tsx:45-51`, plus the rest found by grepping `Loading`.
- Errors (about 25): `text-red-400` in `AddProject.tsx:74`, `AddModule.tsx:217,224`, `ModuleFolderRequired.tsx:77`, `ModuleFolder.tsx:120`, `PromptInput.tsx:78`; `lifecycle-danger` in `WorktreeMergePreview.tsx` ×4, `WorktreeLifecycle.tsx:159`, `DescriptionEditor.tsx:233`, `MarkdownDocumentEditor.tsx:113,123`, `WorktreeSwitcher.tsx:159`, `ModuleFolderSelection.tsx:118`; text-sm in `StoryWorkflowGuideDialog.tsx:86,119,125`, `ChangesFileReview.tsx:169`; hard-coded reds in `NotifyUserModal.tsx:20`, `AutomationFailureChicklet.tsx:48`. Relationship to `SettingsStatusLine` (9 files) is decided in the LLD.

- [ ] The four components exist in `shared/ui` with tests (`status`/`alert` roles, heading count rendering).
- [ ] All instances migrated; settings heading constants and the private `GroupHeading` deleted.
- [ ] No `text-red-400` or hard-coded red in `studio/src` outside tokens.
- [ ] Typecheck, studio tests and `test:overhaul` pass.
