# 11 — StatusDot, Chip and one status colour map

**Parent:** Shared UI component library for Studio (`../spec.md`)
**Blocked by:** None — can start immediately.
**Status:** ready-for-agent
**LLD:** `11-status-dot-chip-and-tones/LLD.md` (+ `LLD.html`)

**What to build:** `StatusDot` (one size; colour from a tone token or a workflow-state colour) and `Chip` (bordered mono chip with optional dot; `removable` and `count` variants; the tiny `badge` size used by lifecycle chicklets). The worktrees feature's four overlapping status-to-colour maps collapse into one. The three identical lifecycle chip-group bodies share one renderer.

**Instances:**
- State-colour dots: `details/ChildIssues.tsx:51`, `fields/BlockerPicker.tsx:51`, `fields/StatePicker.tsx:21` (`Dot`), `WorkflowStatePicker.tsx:36` (`Dot`), `features/workflows/IssueTypesSection.tsx:295`, `details/FindingsPanel.tsx:74` (tinted pill).
- Tone dots: `WorktreeBlock.tsx:333`, `ChangesStateChips.tsx:37,46`, `InspectorSection.tsx:56`, `WorktreeSwitcher.tsx:119,149`, `ConversationRows.tsx:76`, `AppUpdateAvailabilityIndicator.tsx:25`.
- Tone maps (all `features/agents/worktrees/`): `ChangesStateChips.tsx:3` (`toneClass`), `worktreeCheckoutRows.ts:22` (`TONE_CLASS`/`checkoutToneClass`, superset), inline ternary `WorktreeBlock.tsx:238`, `BranchInspector.tsx:236` (`pullRequestTone`).
- Bordered mono chips: `ChangesStateChips.tsx:34,43`, `InspectorSection.tsx:55`, `TransitionDisclosure.tsx:56`.
- Tiny badges: `LifecycleBadge.tsx:70`, `AutomationDeliveryChicklet.tsx:34`, `AutomationFailureChicklet.tsx:48`, `ClaudeStartupAttentionAction.tsx:47`, `ModuleJumpBadge.tsx:13` (if not already done in 02).
- Removable: `BlockerChipView.tsx:28-50`, `StageSkillsField.tsx:35-45`. Count: `DormantWorkspaceTabs.tsx:163`, `FindingsPanel.tsx:45`.
- Chip groups: `features/agents/status/ModuleLifecycleChicklets.tsx`, `features/agents/lifecycle/AgentStateBadge.tsx:27-45`, `ScratchStateBadge.tsx:39-57`.

- [ ] `shared/ui/StatusDot.tsx` and `shared/ui/Chip.tsx` exist with tests (removable chip's remove button label, count rendering).
- [ ] One status colour mapping is exported from the worktrees feature; the other three are deleted.
- [ ] Private `Dot` components deleted.
- [ ] Typecheck, studio tests and `test:overhaul` pass.
