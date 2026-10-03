# LLD 10: SectionHeading, EmptyState, LoadingState and ErrorLine

Status: implementation-ready (no open decisions)
Authority: this `LLD.md` is authoritative. `LLD.html` beside it is a presentation mirror.

## 1. Identity and design basis

- Work item: ticket 10, `.scratch/shared-ui-components/issues/10-headings-and-placeholders.md`.
- Parent story: `.scratch/shared-ui-components/spec.md` (Shared UI component library for Studio), user stories 16 to 19, 25, 30, 34, 35 and 37.
- Module: Ticketry Studio frontend, `studio/src`. The roadmap planner is out of scope.
- Governing rules: repository `CLAUDE.md` (one concern per file, `shared/ui` holds cross-feature plumbing, name by purpose, keep files small) and the spec's Implementation Decisions (closed `variant` and `size` unions, `className` for layout only, theme tokens only, expand and contract migration, keep `data-testid` and `data-*` hooks).
- Delivers: one heading component with three levels, one empty-state component, one loading component and one error component in `studio/src/shared/ui/`, with every instance in the ticket and every sibling found by grep moved onto them. `SETTINGS_EYEBROW_CLASS`, `SETTINGS_SECTION_HEADING_CLASS` and the private `GroupHeading` are deleted. Off-token reds are removed.
- This LLD supersedes nothing. It settles the spec's open point about `SettingsStatusLine` (D-5).

## 2. Scope and invariants

### In scope

- New files: `SectionHeading.tsx`, `EmptyState.tsx`, `LoadingState.tsx`, `ErrorLine.tsx`, the private `placeholderStyles.ts`, and a colocated test per component plus `SettingsPrimitives.test.tsx`.
- Migration of every instance in section 10, including siblings found beyond the ticket list.
- Deleting `SETTINGS_EYEBROW_CLASS`, `SETTINGS_SECTION_HEADING_CLASS`, `GroupHeading` (WorkItemSearchList) and `sectionClassName` (DormantWorkspaceTabs).
- Replacing every `text-red-*`, `bg-red-*` and `border-red-*` utility in `studio/src`, and the matching blue and amber badge colours in `NotifyUserModal`, with lifecycle tokens.

### Invariants

- I-1: Every `data-testid` and `data-*` attribute stays on the element that carries the same content today.
- I-2: The rendered element type is preserved through `as` at every call site. Heading semantics, list semantics and label associations stay as they are, and no new heading roles appear.
- I-3: Empty-state copy and error copy stay verbatim. Loading copy changes only in its ellipsis: three dots become the single character `…` (U+2026), and the two bare-ellipsis lines gain a label (D-8).
- I-4: No screen changes what it does. Only colour, size, weight, tracking and ARIA roles change, as listed.
- I-5: Existing suites stay green. The one intentional assertion change is `src/test/overhaulWorkItemAcceptance.test.tsx:546` (section 10, record `t-workitem-acceptance`).

### Explicit exclusions

- E-1: Pane chrome and tree headers. These are `PaneShell` titles (`titleCasing`), `StateHeaderRow` (the Stories tree is out of scope), `OnboardingWelcome.tsx:29` (accent hero kicker with `tracking-[0.2em]`), the `prose` heading rules in `app/styles/tailwind.css:204-210`, and `NotifyUserModal`'s severity badge shape (a chip, ticket 11).
- E-2: Page titles at `text-lg` (`ServiceHealthGate`, `main.tsx`, the `SettingsModal` h1, the two overlay h1s, `KeyboardShortcutsModal` h2 at :78). `SectionHeading` has no page-title level.
- E-3: Busy or status text inside other controls is not a `LoadingState`. Examples are button labels (`Committing...`, `Merging...`, `Saving…`, `Retrying…`), picker trigger text (`PickerTrigger.tsx:45` `…`, `WorktreeSwitcher.tsx:120` `Loading checkouts...`), count labels (`ChangesFileReview.tsx:103` `Loading changes...`, which tests assert verbatim), `NameEditor.tsx:35` `saving…`, and `launchProviderCatalog.ts` `Loading providers…` (already a named status). Their text stays.
- E-4: Toasts (`ToastHost`), diff colouring (`RawPatch`, deletion counts), danger buttons and hover states, `LifecycleBadge` tones, `IssueActionsMenu` delete item, `WorktreeBlock.tsx:251` conflict summary, `MarkdownDocumentEditor.tsx:65` conflict notice (attention tone with actions), `StoryHandoffGuidance.tsx:47` provider-load guidance (`role="status"` by design), and `ModalErrorBoundary`'s card-level `role="alert"`.
- E-5: Data palettes. These are `codeMirrorDarkTheme.ts` syntax colours and `shared/utilities/display.ts` workflow-state colours (ticket 11 owns state colour mapping).
- E-6: `ChangedFilesList.tsx:149` empty region. It is a focusable keyboard region with its own focus ring and `aria-label`, not a passive placeholder.
- Conversation prototypes are migrated only where the change is a one-element swap (record `h-prototypes`).

## 3. Repository findings and preflight gates

- `studio/src/shared/ui/` holds `Popover.tsx`, `PopoverContent.tsx`, `PopoverSearch.tsx`, `SettingsPrimitives.tsx` (104 lines), `KeyChordHint.tsx`, `IssueTypeLabel.tsx`, `PaneResizeHandle.tsx` and `icons.tsx`. It has no barrel file, so callers import each file directly. No colocated tests exist there yet. `vitest.config.ts` includes `src/**/*.test.{ts,tsx}` under jsdom with `src/test/setup.ts`.
- `SettingsPrimitives.tsx` exports `SETTINGS_SECTION_HEADING_CLASS` (`text-base font-semibold text-text-primary`) and `SETTINGS_EYEBROW_CLASS` (`text-xs font-semibold uppercase tracking-wide text-text-secondary`). `SETTINGS_SECTION_HEADING_CLASS` is imported by `KeybindingSettings`, `KeyboardSettingsPanel`, `SettingsModal`, `InstantSettingsPanel` and `AppUpdatesSection`. `SETTINGS_EYEBROW_CLASS` is imported by `SettingsModal`, `StateLaunchConfiguration` and `TransitionDisclosure`. Both are also used inside `SettingsSubsection`.
- `SettingsStatusLine` (tones `success`, `attention`, `danger`; `role` alert for danger, status otherwise; classes `border-l-2 px-3 py-2 text-sm` plus a tone tint) has three dynamic-tone callers: `SettingsModal.tsx:137` (`modelStatus.tone`), `InstantSettingsPanel.tsx:104` (`message.tone`) and `KeyboardSettingsPanel.tsx:209` (`message.kind`). It has eleven static `tone="danger"` sites in `IssueTypesSection`, `StateLaunchConfiguration`, `TransitionDisclosure`, `LaunchConfigurationForm`, `StateCatalog` (×2) and `StateConfigurationPanel` (×5), and one static `tone="attention"` at `StateConfigurationPanel.tsx:174`. That is nine files in all.
- Eyebrow variants found: weights `font-semibold`, `font-bold` and none; tracking `tracking-wide` and `tracking-wider`; colours `text-text-secondary` and `text-text-muted`; sizes `text-xs`, `text-sm` and `text-[10px]`. The `tailwind.config.ts` comment on `text.secondary` names it the eyebrow and section-label colour.
- Tokens available in `studio/tailwind.config.ts`: `text-text-primary`, `text-text-secondary`, `text-text-muted`, `lifecycle-danger` (`#f7768e`), `lifecycle-attention`, `lifecycle-idle`, `lifecycle-success`, and font sizes `xs` (11px), `sm` (12.5px) and `base` (14px). No new token is needed.
- No test asserts placeholder or heading class strings (`grep toHaveClass|className` over the test files finds none for these utilities). Source-scan tests (`squareCornerScan`, `moduleBoundaries`) do not constrain these files beyond the existing rules: no `rounded` utilities, and `shared` must not import `features`.
- Preflight gate: before batch B, confirm that the eleven static danger sites and three dynamic sites match section 3. If a new `SettingsStatusLine` caller with a `role` prop or a new static `tone="danger"` site has landed, migrate it the same way. If any caller needs a variant not in section 5, stop and report it. Do not add a variant.
- Preflight gate: tickets 05 and 06 also edit `SettingsPrimitives.tsx` (`settingsButtonClass`, `SETTINGS_FIELD_CLASS`). Rebase onto whichever landed first, and keep their exports untouched.

## 4. Decisions

- D-1 SectionHeading levels. `eyebrow` renders `text-xs font-semibold uppercase tracking-wider` plus the tone colour (`text-text-secondary`, or `text-text-muted` when `tone="muted"`). `title` renders `text-base font-semibold text-text-primary` and replaces `SETTINGS_SECTION_HEADING_CLASS`. `section` renders the eyebrow-styled label plus an optional count, inside a `flex items-center gap-2` wrapper. The section label uses the eyebrow class exactly, so the label style exists once.
- D-2 EmptyState variants. `inline` is text only: `text-text-muted` with size `sm` (`text-sm`, default) or `xs` (`text-xs`). Row padding is supplied by the caller as `className="px-3 py-2"`, so popover rows and bare lines keep their spacing. `pane` is the centred full-pane layout `flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center text-sm` with `text-text-muted`. Pane children may include an action button.
- D-3 LoadingState. It always renders `role="status"` and the single text node `${label}…`. Variants `inline` and `pane` use the same layouts as EmptyState.
- D-4 ErrorLine. It always renders `role="alert"` and colours with `lifecycle-danger`. It has three variants: `inline` (text), `banner` (`border-l-2 border-l-lifecycle-danger bg-lifecycle-danger/10 px-3 py-2`, the current settings danger look) and `pane` (the shared pane layout).
- D-5 SettingsStatusLine relationship. ErrorLine replaces the danger tone's implementation. `SettingsStatusLine` keeps its three-tone union so the three dynamic callers stay branch-free. When `tone="danger"` it returns `<ErrorLine variant="banner">`, and its `STATUS_TONE_CLASS` loses the danger entry. Every static `tone="danger"` site calls `ErrorLine variant="banner"` directly. After migration, a literal `tone="danger"` appears nowhere in `studio/src` (grep gate G-4). The error look and role therefore live only in `ErrorLine.tsx`. `SettingsStatusLine` remains the success and attention status line in `SettingsPrimitives.tsx`, and that file shrinks.
- D-6 Element preservation. Every component takes `as`. SectionHeading accepts `h1`, `h2`, `h3`, `h4`, `p`, `div`, `span`, `legend` and `label`, with defaults eyebrow `h3`, section `span` and title `h2`. The placeholder components accept `div`, `p`, `span` and `li`, defaulting to `div`; pane variants always render a `div`. Each migration names the `as` that reproduces today's element (I-2).
- D-7 className contract. `className` may carry spacing (`m*`, `p*`), display and placement (`block`, `flex-1`, `min-w-0`, `text-right` alignment, grid placement) only. It never carries colour, size, weight, tracking, border or background. Where today's element mixes a divider into a heading (KeyboardShortcutsModal :109), a wrapper element carries the divider.
- D-8 Copy rules. Empty and error copy are passed through unchanged. LoadingState appends `…`, so labels never contain an ellipsis. The bare `…` loading lines become `Loading modules` (ModulesPane) and `Loading stories` (TasksPane). Busy labels inside controls are excluded (E-3).
- D-9 Tokens only. No hex values or palette utilities (`red-*`, `blue-*`, `amber-*`) are used. NotifyUserModal maps info to `lifecycle-idle`, warning to `lifecycle-attention` and error to `lifecycle-danger`. AutomationFailureChicklet uses `lifecycle-danger`. `tailwind.config.ts` is unchanged.

## 5. Component contracts

All four components are named exports from one file each in `studio/src/shared/ui/`. They hold no state, effects or context and cannot fail at runtime. Props not listed below pass through to the rendered element, as do `id`, `aria-*`, `data-*` and, unless stated, `role`.

### SectionHeading (`SectionHeading.tsx`)

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `level` | `"eyebrow" \| "section" \| "title"` | required | Chooses the style (D-1). |
| `as` | `"h1" \| "h2" \| "h3" \| "h4" \| "p" \| "div" \| "span" \| "legend" \| "label"` | eyebrow `h3`, section `span`, title `h2` | The label or heading element. |
| `tone` | `"secondary" \| "muted"` | `"secondary"` | eyebrow and section only; ignored for title. |
| `count` | `ReactNode` | none | section only. Rendered after the label in `<span class="text-xs text-text-muted">` when not `null` or `undefined`; `0` renders. |
| `htmlFor` | `string` | none | Forwarded when `as="label"`. |
| `className` | `string` | none | Layout only (D-7); applied to the wrapper for section and to the element otherwise. |
| `children` | `ReactNode` | required | Label text. |
| rest | `HTMLAttributes<HTMLElement>` | none | Applied to the label or heading element. |

### EmptyState (`EmptyState.tsx`)

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `variant` | `"inline" \| "pane"` | `"inline"` | D-2. |
| `size` | `"sm" \| "xs"` | `"sm"` | inline only. |
| `as` | `"div" \| "p" \| "span" \| "li"` | `"div"` | inline only; pane is always `div`. |
| `className` | `string` | none | Layout only. |
| `children` | `ReactNode` | required | Verbatim copy and optional action. |
| rest | `HTMLAttributes<HTMLElement>` | none | Includes `role` (`status`, `alert`, `presentation`) and `aria-live`. No role by default. |

### LoadingState (`LoadingState.tsx`)

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `label` | `string` | required | Rendered as `${label}…`; must not end in an ellipsis. |
| `variant` | `"inline" \| "pane"` | `"inline"` | D-3. |
| `size` | `"sm" \| "xs"` | `"sm"` | inline only. |
| `as` | `"div" \| "p" \| "span" \| "li"` | `"div"` | inline only. |
| `className` | `string` | none | Layout only. |
| rest | `Omit<HTMLAttributes<HTMLElement>, "role" \| "children">` | none | `role="status"` is fixed. |

### ErrorLine (`ErrorLine.tsx`)

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `variant` | `"inline" \| "banner" \| "pane"` | `"inline"` | D-4. |
| `size` | `"sm" \| "xs"` | `"sm"` | inline and banner. |
| `as` | `"div" \| "p" \| "span" \| "li"` | `"div"` | inline and banner; pane is always `div`. |
| `className` | `string` | none | Layout only. |
| `children` | `ReactNode` | required | Verbatim copy; may contain buttons and paragraphs. |
| rest | `Omit<HTMLAttributes<HTMLElement>, "role">` | none | `role="alert"` is fixed. |

### Private styles (`placeholderStyles.ts`)

| Export | Value |
| --- | --- |
| `PLACEHOLDER_TEXT_SIZE` | `{ sm: "text-sm", xs: "text-xs" }` |
| `PANE_PLACEHOLDER_LAYOUT` | `flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center text-sm` |
| `PlaceholderElement` | `"div" \| "p" \| "span" \| "li"` |
| `PlaceholderSize` | `"sm" \| "xs"` |

### Changed contract in `SettingsPrimitives.tsx`

| Symbol | After this ticket |
| --- | --- |
| `SETTINGS_SECTION_HEADING_CLASS` | Deleted. Use `SectionHeading level="title"`. |
| `SETTINGS_EYEBROW_CLASS` | Deleted. Use `SectionHeading level="eyebrow"`. |
| `SettingsStatusLine` | Same tone union; props extend `Omit<HTMLAttributes<HTMLDivElement>, "role">`. `danger` delegates to `ErrorLine variant="banner"`; `success` and `attention` keep `role="status"` and their tints. |
| `SettingsSubsection` | Same props. Renders `SectionHeading level="title" as="h2"` (headingRole `section`) or `level="eyebrow" as="h3"` (default). |

## 6. Test-asserted strings and hooks to preserve

| String or hook | Asserted in | Rule |
| --- | --- | --- |
| `Loading providers…` | overhaulProviderSettingsAcceptance :160, :207 | `label="Loading providers"`. |
| `Loading issue…` | overhaulWorkItemAcceptance :545; e2e/overhaul.spec.ts :224, :231 | `label="Loading issue"`. |
| `Loading diff` (substring, role status, empty name) | overhaulChangesDiffKeyboardAcceptance :240 | Text becomes `Loading diff…`; still matches. |
| `Loading workflow` (role status) | overhaulStoryWorkflowGuideAcceptance :552 | `label="Loading workflow"`. |
| `Applying…`, `Saving…` | e2e/web-app.spec.ts, e2e/overhaul.spec.ts | `label="Applying"`, `label="Saving"`. |
| `Loading changes...` | overhaulModuleVersionControlAcceptance :220, :588; overhaulChangesWorkspaceRecoveryAcceptance :121 | Excluded control label (E-3); unchanged. |
| `…` in the state picker | overhaulTransitionLandingAcceptance :98, :112 | `PickerTrigger` excluded (E-3); unchanged. |
| `…` in the Stories pane (negative assertion) | overhaulWorkItemAcceptance :546 | Updated to `Loading stories…` (the only intentional assertion change). |
| `No current task worktrees.`, `No matching branches`, `No textual changes to display.`, `No modules yet. Add a module to start planning work.`, `No stories match "…"` status | ModuleVersionControl, TaskWorktreeChanges, ChangesDiffKeyboard, ModuleVisibility, WorkItemRow acceptance suites | Copy verbatim; roles kept through rest props. |
| `Unable to load worktree checkouts.`, `Unable to load this file diff.`, all other `findByRole("alert")` texts | WorktreeSwitcherFailure, ChangesDiffKeyboard, AppUpdates, StoryWorkflowGuide, DocumentSaveRuntime, DescriptionAutosave, OnboardingModule, DirectoryTrust, WorktreeMergeRecovery, WorktreeCleanup, ChangesActions, ProviderSettings acceptance suites | Copy verbatim; ErrorLine keeps `role="alert"`. |
| `data-testid`: `field-label`, `child-issues`, `attachments`, `findings-queued-count`, `empty-project-workspace`, `empty-module-workspace`, `issue-not-found`, `issue-load-error`, `terminal-panel-empty`, `terminal-panel-failure`, `terminal-panel-no-shells`, `terminal-panel-dead-shell` (+ `data-exit-code`), `onboarding-step-error`, `settings-scroll-container` | Detail, terminal panel, module visibility and onboarding suites | Passed through rest props on the same element (I-1). |
| Single-role queries (`getByRole("status")` without a name) | overhaulModuleVersionControlAcceptance :694, :882; overhaulChangesActionsAcceptance :71, :115; overhaulTaskWorktreeChangesAcceptance :550, :1006; overhaulWorktreeCleanupAcceptance :199, :271; overhaulModalLoadFailureAcceptance :106 | No new `role="status"` is added in the Changes, worktree or modal-host surfaces those tests render, apart from the lines that already had it. ModuleVersionControl :131 moves from status to alert, which reduces the count of status roles. |

New roles introduced: status on ModulesPane, TasksPane, OnboardingProviders, SettingsModal and ModelConfigurationPanel fallbacks, StateCatalog impact, StatusUpdate and ParentUpdate saving, LaunchConfigurationForm applying, WorkflowSettingsPanel, StateConfigurationPanel and IssueTypesSection loading. Alert on OnboardingTour, StoryWorkflowGuideStages :13, WorktreeMergePreview :189, WorktreeBlock :380, and the six former `text-red-400` lines (which already had alert). If any existing single-role query then fails, stop and report the collision. Do not change the test or drop the role.

## 7. Runtime behaviour and failure semantics

- The components are presentational. ARIA live regions announce on insertion: `role="status"` is polite and `role="alert"` is assertive. Conditional rendering already mounts these lines only when the state applies, so no new announcement appears without a state change.
- Nothing persists, fetches or retries. Retry buttons inside ErrorLine children keep their existing handlers.
- Typecheck is the failure signal for misuse. A caller that passes `role` to LoadingState or ErrorLine, an unknown `variant`, `size` or `as`, or a `count` without `level="section"` compiles but renders no count. `count` is typed on all levels for simplicity, and the test pins that only section renders it.

## 8. Migration batches (ordered implementation plan)

| Batch | Work | Depends on | Local signal |
| --- | --- | --- | --- |
| A | Add `placeholderStyles.ts`, `SectionHeading.tsx`, `EmptyState.tsx`, `LoadingState.tsx`, `ErrorLine.tsx` and their four tests. No caller changes. | none | The four new test files pass; `npm run typecheck`. |
| B | Headings: every `h-*` record. Rebuild `SettingsSubsection`, delete `GroupHeading` and `sectionClassName`, then delete the two heading constants from `SettingsPrimitives.tsx`. Add the subsection half of `SettingsPrimitives.test.tsx`. | A | Grep gates G-1 and G-2; typecheck; `npm run test:overhaul`. |
| C | Empty states: every `e-*` and `p-*` record. | A | G-6 spot-check; affected suites. |
| D | Loading states: every `l-*` record, the loading lines inside B, C and E records, and the `overhaulWorkItemAcceptance.test.tsx:546` edit in the same commit as TasksPane. | A | G-5; overhaulWorkItemAcceptance; overhaulModalLoadFailureAcceptance. |
| E | Errors: every `r-*` record and the error lines inside other records. Make `SettingsStatusLine` delegate danger to ErrorLine, move the eleven static danger sites, and recolour NotifyUserModal and AutomationFailureChicklet. Add the delegation half of `SettingsPrimitives.test.tsx`. | A | G-3, G-4; overhaul suites. |
| F | Full verification: section 9 commands and every grep gate. | B to E | All green. |

Batches B to E touch disjoint lines and may land in any order after A. A file that appears in several batches (for example `StateConfigurationPanel.tsx`) can take all its swaps in one commit, provided the batch's gate runs before merge. Each batch deletes what it replaces in the same change (expand and contract). No compatibility alias for the deleted constants remains.

## 9. Verification

### Commands (from the repository root)

- `npm run typecheck`
- `npm run test --workspace @worktracker/studio`
- `npm run test:overhaul --workspace @worktracker/studio`
- `npm run build --workspace @worktracker/studio`

### Grep gates (run in `studio/src`)

- G-1: `grep -rn "SETTINGS_EYEBROW_CLASS\|SETTINGS_SECTION_HEADING_CLASS" .` returns nothing.
- G-2: `grep -rn "function GroupHeading\|sectionClassName" .` returns nothing.
- G-3: `grep -rnE "(text|bg|border)-(red|rose)-[0-9]" .` returns nothing, and `grep -nE "(blue|amber)-[0-9]" app/modal/NotifyUserModal.tsx` returns nothing.
- G-4: `grep -rn 'tone="danger"' .` returns nothing.
- G-5: `grep -rnE "Loading[^\"<]*\.\.\." --include=*.tsx .` returns only the E-3 control labels `ChangesFileReview.tsx:103` and `WorktreeSwitcher.tsx:120`.
- G-6: `grep -rn "uppercase tracking" --include=*.tsx .` returns only `SectionHeading.tsx` and the E-1 exclusions (`StateHeaderRow.tsx`, `OnboardingWelcome.tsx`, `NotifyUserModal.tsx` badge, `ConversationInboxVariant.tsx:330`).

### Tests to add (vitest plus @testing-library/react, colocated; no class-string assertions)

- `studio/src/shared/ui/SectionHeading.test.tsx`: title `as="h2"` is a level-2 heading with its name. Default eyebrow is a level-3 heading, and `as="span"` adds no heading role. Section `count={3}` renders `3` beside the label, no `count` renders only the label, and `count={0}` renders `0`. `as="label" htmlFor` associates with an input. `id` and `role="presentation"` pass through.
- `studio/src/shared/ui/EmptyState.test.tsx`: children render verbatim with no role. `role="status"` and `data-testid` pass through. `as="li"` in a `ul` is a listitem. The pane variant renders its button child.
- `studio/src/shared/ui/LoadingState.test.tsx`: `getByRole("status")` has text exactly `Loading issue…`. The pane variant and `as="span"` keep role status. `data-testid` passes through.
- `studio/src/shared/ui/ErrorLine.test.tsx`: the inline, banner and pane variants each expose `getByRole("alert")` with the children text. A child Retry button fires its handler. `id` and `aria-label` pass through.
- `studio/src/shared/ui/SettingsPrimitives.test.tsx`: `SettingsStatusLine` danger exposes role alert, and success and attention expose role status. `SettingsSubsection` renders a level-2 heading for headingRole `section` and a level-3 heading by default.

### Manual check

- Run `npm run web`. Open Settings (Models, Workflows, Keyboard), a story detail (child issues, findings, fields), the Changes view (worktree switcher, merge preview), the module picker, the terminal panel empty state and onboarding. Confirm the headings read in one style, the placeholders are muted, and the errors are pink (`lifecycle-danger`) with no clipping.

## 10. File and component change map

Line numbers are from the snapshot at `a2541323`. Implementers locate each line by the quoted copy or symbol, since earlier batches shift lines.

| Path | Action | Batch | Purpose |
| --- | --- | --- | --- |
| `studio/src/shared/ui/SectionHeading.tsx` | create | A | The one heading component: eyebrow, section (label plus optional count) and title levels. |
| `studio/src/shared/ui/EmptyState.tsx` | create | A | The one 'nothing here' placeholder, inline for lists and popover rows, pane for centred full-pane messages. |
| `studio/src/shared/ui/LoadingState.tsx` | create | A | The one in-progress line: always role status, always ends in the single ellipsis character. |
| `studio/src/shared/ui/ErrorLine.tsx` | create | A | The one error message: always role alert, always lifecycle-danger. |
| `studio/src/shared/ui/placeholderStyles.ts` | create | A | Private class constants shared by EmptyState, LoadingState and ErrorLine so the pane layout and sizes exist once. |
| `studio/src/shared/ui/SectionHeading.test.tsx` | create | A | Behaviour test for SectionHeading. |
| `studio/src/shared/ui/EmptyState.test.tsx` | create | A | Behaviour test for EmptyState. |
| `studio/src/shared/ui/LoadingState.test.tsx` | create | A | Behaviour test for LoadingState. |
| `studio/src/shared/ui/ErrorLine.test.tsx` | create | A | Behaviour test for ErrorLine. |
| `studio/src/shared/ui/SettingsPrimitives.test.tsx` | create | B, E | Pins the SettingsStatusLine-to-ErrorLine delegation and the rebuilt SettingsSubsection headings. |
| `studio/src/shared/ui/SettingsPrimitives.tsx` | modify | B, E | Lose the two heading constants; SettingsStatusLine routes its danger tone to ErrorLine; SettingsSubsection renders SectionHeading. |
| `studio/src/features/studio/modals/SettingsModal.tsx` | modify | B, D | Settings shell headings and loading fallback move onto shared components. |
| `studio/src/features/studio/modals/KeyboardSettingsPanel.tsx` | modify | B | Bindings title and the column-header row use SectionHeading. |
| `studio/src/features/studio/modals/KeybindingSettings.tsx` | modify | B | Keyboard shortcuts title uses SectionHeading. |
| `studio/src/features/settings/instant/InstantSettingsPanel.tsx` | modify | B | Conversations title uses SectionHeading. |
| `studio/src/features/app-updates/AppUpdatesSection.tsx` | modify | B, E | App updates heading and its two hand-built danger banners. |
| `studio/src/features/workflows/StateLaunchConfiguration.tsx` | modify | B, E | Two h4 eyebrows and the control error banner. |
| `studio/src/features/workflows/TransitionDisclosure.tsx` | modify | B, E | Transition properties eyebrow and error banner. |
| `studio/src/features/workflows/StateConfigurationPanel.tsx` | modify | B, C, D, E | Overlay eyebrow, four titles, direction label, loading, empty and six error banners. |
| `studio/src/features/settings/instant/ConversationConfigurationPanel.tsx` | modify | B | Overlay eyebrow uses SectionHeading. |
| `studio/src/app/onboarding/OnboardingProviders.tsx` | modify | B, D, E | Legend eyebrow, loading line and error line. |
| `studio/src/features/studio/modals/AddModule.tsx` | modify | B, E | Two label eyebrows and two red error lines. |
| `studio/src/features/agents/terminal/ModuleFolderSelection.tsx` | modify | B, E | Recent folders eyebrow and error line. |
| `studio/src/features/studio/modals/KeyboardShortcutsModal.tsx` | modify | B | Two section eyebrows and the table header labels. |
| `studio/src/features/agents/worktrees/changes/BranchInspector.tsx` | modify | B | Branch eyebrow. |
| `studio/src/features/agents/worktrees/changes/WorktreeSwitcher.tsx` | modify | B, C, D, E | Popover eyebrow, failure, loading and empty lines. |
| `studio/src/features/documents/MarkdownDocumentEditor.tsx` | modify | B, E | Comparison eyebrows and the two Save failed lines. |
| `studio/src/features/work-items/WorkItemSearchList.tsx` | modify | B, C | Delete private GroupHeading; empty row uses EmptyState. |
| `studio/src/app/shell/ticket-workspace/selected-ticket/internal/DormantWorkspaceTabs.tsx` | modify | B | Menu section labels use SectionHeading. |
| `studio/src/app/modal/ModalShell.tsx` | modify | B | Modal title eyebrow. |
| `studio/src/app/modal/ModalErrorBoundary.tsx` | modify | B | Error card heading. |
| `studio/src/app/shell/ticket-workspace/selected-ticket/details/ChildIssues.tsx` | modify | B, C | Child issues section heading with count and the empty row. |
| `studio/src/app/shell/ticket-workspace/selected-ticket/details/Attachments.tsx` | modify | B | Attachments section heading with count. |
| `studio/src/app/shell/ticket-workspace/selected-ticket/details/FindingsPanel.tsx` | modify | B | Review findings section heading; the queued chip rides in `count`. |
| `studio/src/app/shell/ticket-workspace/selected-ticket/details/Field.tsx` | modify | B | Field label uses the eyebrow style with muted tone. |
| `studio/src/features/workflows/StateCatalog.tsx` | modify | B, D, E | Delete-confirm title, loading line and two danger banners. |
| `studio/src/features/workflows/WorkflowImpactDialog.tsx` | modify | B | Impact dialog title. |
| `studio/src/app/onboarding/CoachMark.tsx` | modify | B | Coach mark title. |
| `studio/src/features/workflows/IssueTypesSection.tsx` | modify | B, C, D, E | Issue type title, split loading/empty paragraph and the InlineError helper. |
| `studio/src/features/workflows/StoryWorkflowGuideDialog.tsx` | modify | B, D, E | Four guide titles, two loading lines and three error lines. |
| `studio/src/features/conversations/prototype/ConversationInboxVariant.tsx` | modify | B | Trivial swaps only in the conversation prototypes. |
| `studio/src/features/conversations/prototype/ConversationTimelineVariant.tsx` | modify | B | Same change set as ConversationInboxVariant.tsx: Trivial swaps only in the conversation prototypes. |
| `studio/src/app/shell/ticket-workspace/selected-ticket/details/fields/StatePicker.tsx` | modify | C | Popover empty rows in the three detail pickers. |
| `studio/src/app/shell/ticket-workspace/selected-ticket/details/WorkflowStatePicker.tsx` | modify | C | Same change set as StatePicker.tsx: Popover empty rows in the three detail pickers. |
| `studio/src/app/shell/ticket-workspace/selected-ticket/details/fields/IssueTypePicker.tsx` | modify | C | Same change set as StatePicker.tsx: Popover empty rows in the three detail pickers. |
| `studio/src/features/agents/worktrees/changes/MergeDestinationPicker.tsx` | modify | C | No matching branches row. |
| `studio/src/app/shell/sidebar/modules/ModulesPane.tsx` | modify | C, D | Modules pane loading and empty lines. |
| `studio/src/app/shell/ticket-workspace/tasks/TasksPane.tsx` | modify | C, D | Stories pane loading and empty lines. |
| `studio/src/app/shell/ticket-workspace/tasks/components/StoriesSearchEmptyState.tsx` | modify | C | Search no-match message. |
| `studio/src/app/shell/ticket-workspace/selected-ticket/SelectedTicketContent.tsx` | modify | C | No task selected lines. |
| `studio/src/app/shell/ticket-workspace/selected-ticket/details/SelectedTicketDetails.tsx` | modify | C | Same change set as SelectedTicketContent.tsx: No task selected lines. |
| `studio/src/features/studio/modals/StatusUpdate.tsx` | modify | C, D | Status and parent modal empty and saving lines. |
| `studio/src/features/studio/modals/ParentUpdate.tsx` | modify | C, D | Same change set as StatusUpdate.tsx: Status and parent modal empty and saving lines. |
| `studio/src/features/workflows/WorkflowSettingsPanel.tsx` | modify | C, D, E | Workflow settings select-a-project and loading lines, plus the guide stages notes. |
| `studio/src/features/workflows/StoryWorkflowGuideStages.tsx` | modify | C, D, E | Same change set as WorkflowSettingsPanel.tsx: Workflow settings select-a-project and loading lines, plus the guide stages notes. |
| `studio/src/features/agents/worktrees/changes/ChangesFileReview.tsx` | modify | C, D, E | Diff region placeholders. |
| `studio/src/app/shell/ticket-workspace/EmptyModuleWorkspace.tsx` | modify | C | Both full-pane module placeholders. |
| `studio/src/app/shell/ticket-workspace/selected-ticket/details/IssueDetail.tsx` | modify | C, D, E | Issue detail loading, not-found and load-error panes. |
| `studio/src/features/terminal-panel/TerminalPanel.tsx` | modify | C | Terminal panel body placeholders. |
| `studio/src/features/terminal-panel/DeadShell.tsx` | modify | C | Same change set as TerminalPanel.tsx: Terminal panel body placeholders. |
| `studio/src/features/workflows/ModelConfigurationPanel.tsx` | modify | D | Model configuration loading line. |
| `studio/src/features/agents/worktrees/changes/WorktreeMergePreview.tsx` | modify | D, E | Merge preview loading and the four-plus error lines. |
| `studio/src/app/modal/ModalHost.tsx` | modify | D | Lazy modal fallback. |
| `studio/src/app/onboarding/StoryHandoffGuidance.tsx` | modify | D | Onboarding checking lines. |
| `studio/src/features/workflows/LaunchConfigurationForm.tsx` | modify | D, E | Applying line and validation banner. |
| `studio/src/features/studio/modals/AddProject.tsx` | modify | E | Replace the remaining text-red-400 error lines. |
| `studio/src/features/terminal-panel/ModuleFolderRequired.tsx` | modify | E | Same change set as AddProject.tsx: Replace the remaining text-red-400 error lines. |
| `studio/src/features/agents/terminal/ModuleFolder.tsx` | modify | E | Same change set as AddProject.tsx: Replace the remaining text-red-400 error lines. |
| `studio/src/features/agents/terminal/PromptInput.tsx` | modify | E | Same change set as AddProject.tsx: Replace the remaining text-red-400 error lines. |
| `studio/src/features/agents/worktrees/changes/WorktreeLifecycle.tsx` | modify | E | Worktree lifecycle, action alert, block and module checkout errors. |
| `studio/src/features/agents/worktrees/changes/ChangesActionAlert.tsx` | modify | E | Same change set as WorktreeLifecycle.tsx: Worktree lifecycle, action alert, block and module checkout errors. |
| `studio/src/features/agents/worktrees/WorktreeBlock.tsx` | modify | E | Same change set as WorktreeLifecycle.tsx: Worktree lifecycle, action alert, block and module checkout errors. |
| `studio/src/features/agents/worktrees/changes/ModuleVersionControl.tsx` | modify | E | Same change set as WorktreeLifecycle.tsx: Worktree lifecycle, action alert, block and module checkout errors. |
| `studio/src/features/documents/DescriptionEditor.tsx` | modify | E | Document error lines. |
| `studio/src/features/documents/DocViewer.tsx` | modify | E | Same change set as DescriptionEditor.tsx: Document error lines. |
| `studio/src/app/onboarding/OnboardingTour.tsx` | modify | E | Tour step error. |
| `studio/src/app/modal/NotifyUserModal.tsx` | modify | E | Severity badge colours move to lifecycle tokens. |
| `studio/src/features/agents/lifecycle/AutomationFailureChicklet.tsx` | modify | E | Failure chicklet colours move to lifecycle-danger. |
| `studio/src/test/overhaulWorkItemAcceptance.test.tsx` | modify | D | The one intentional assertion change: the Stories pane loading text is no longer a bare ellipsis. |
| `studio/tailwind.config.ts` | untouched | - | Every class the components use already exists as a token. |
| `studio/src/app/shell/ToastHost.tsx` | untouched | - | Toasts keep their own alert and status roles and tinted panels. |
| `studio/src/app/shell/ticket-workspace/tasks/components/StateHeaderRow.tsx` | untouched | - | Stories tree state headers stay mono and bold; the tree is out of scope. |

### Per-record detail

#### section-heading · create · `studio/src/shared/ui/SectionHeading.tsx`

Purpose: The one heading component: eyebrow, section (label plus optional count) and title levels.

Symbols: `SectionHeading`, `SectionHeadingLevel`, `SectionHeadingElement`.

Responsibilities and exact work:

- Render level eyebrow as `text-xs font-semibold uppercase tracking-wider` plus the tone colour (`text-text-secondary` default, `text-text-muted` for tone muted).
- Render level title as `text-base font-semibold text-text-primary`.
- Render level section as a wrapper `flex items-center gap-2` holding the eyebrow-styled label element and, when `count` is not null or undefined, a `<span>` styled `text-xs text-text-muted` containing `count`.
- Render the element named by `as` (default: eyebrow h3, section span, title h2) and pass `id`, `role`, `aria-*`, `data-*` and `htmlFor` to that element.
- Apply `className` to the outermost element (the wrapper for section, the heading element otherwise).
- Props: `level` (required), `as`, `tone` (eyebrow and section only), `count` (section only), `htmlFor`, `className`, `children`, plus `HTMLAttributes<HTMLElement>`.
- Create the element with `createElement(as ?? defaultFor(level), ...)`; no polymorphic generic typing.
- Ignore `count` for eyebrow and title; ignore `tone` for title.

Preserved boundary:

- Does not accept colour, size or weight overrides; `className` is layout only (D-7).
- Does not render page titles (`text-lg` h1 in overlays, Settings, ServiceHealthGate); those stay as they are.

Verification: SectionHeading.test.tsx passes. Typecheck passes for every caller in batch B.

Dependency: No dependency. Lands in batch A before any caller. Tests: `shared/ui/SectionHeading.test.tsx`. Trace: D-1, D-6, D-7, AC-1.

#### empty-state · create · `studio/src/shared/ui/EmptyState.tsx`

Purpose: The one 'nothing here' placeholder, inline for lists and popover rows, pane for centred full-pane messages.

Symbols: `EmptyState`.

Responsibilities and exact work:

- variant inline (default): element from `as` (div default, or p, li, span) with `text-text-muted` and the size class (`text-sm` for sm default, `text-xs` for xs).
- variant pane: a div with `PANE_PLACEHOLDER_LAYOUT` plus `text-text-muted`; children may include an action button.
- Pass every other HTML attribute through, including `role` (`status`, `alert`, `presentation`), `aria-live`, `data-testid` and `data-exit-code`.
- Props: `variant`, `size`, `as`, `className`, `children`, plus `HTMLAttributes<HTMLElement>`.
- Import size and pane classes from placeholderStyles.ts.

Preserved boundary:

- Sets no role by default.
- Never rewrites or appends to its children; empty copy stays verbatim (D-8).

Verification: EmptyState.test.tsx passes.

Dependency: Depends on placeholderStyles.ts. Batch A. Tests: `shared/ui/EmptyState.test.tsx`. Trace: D-2, D-6, D-7, AC-1.

#### loading-state · create · `studio/src/shared/ui/LoadingState.tsx`

Purpose: The one in-progress line: always role status, always ends in the single ellipsis character.

Symbols: `LoadingState`.

Responsibilities and exact work:

- Render `role="status"` on the rendered element; callers cannot override it.
- Render the single text node `${label}…` (U+2026). `label` is required and must not itself end in an ellipsis.
- variant inline (default): element from `as` (div default, or p, span, li), `text-text-muted` plus size class.
- variant pane: div with `PANE_PLACEHOLDER_LAYOUT` plus `text-text-muted`.
- Props: `label`, `variant`, `size`, `as`, `className`, plus `Omit<HTMLAttributes<HTMLElement>, "role" | "children">`.
- Spread rest before `role` so `role` always wins.

Preserved boundary:

- Is not used for busy text inside buttons, picker triggers or count labels (exclusions E-3).

Verification: LoadingState.test.tsx passes.

Dependency: Depends on placeholderStyles.ts. Batch A. Tests: `shared/ui/LoadingState.test.tsx`. Trace: D-3, D-8, AC-1, AC-5.

#### error-line · create · `studio/src/shared/ui/ErrorLine.tsx`

Purpose: The one error message: always role alert, always lifecycle-danger.

Symbols: `ErrorLine`.

Responsibilities and exact work:

- Render `role="alert"` on the rendered element; callers cannot override it.
- variant inline (default): element from `as` (div default, or p, span, li), `text-lifecycle-danger` plus size class.
- variant banner: element from `as`, `border-l-2 border-l-lifecycle-danger bg-lifecycle-danger/10 px-3 py-2 text-lifecycle-danger` plus size class. This is the exact look of today's `SettingsStatusLine` danger tone.
- variant pane: div with `PANE_PLACEHOLDER_LAYOUT` plus `text-lifecycle-danger`.
- Render arbitrary children, including retry buttons and nested paragraphs.
- Props: `variant`, `size`, `as`, `className`, `children`, plus `Omit<HTMLAttributes<HTMLElement>, "role">`.
- Spread rest before `role`.

Preserved boundary:

- Does not render toasts (ToastHost keeps its own alert).
- Does not own attention or success tones.

Verification: ErrorLine.test.tsx passes.

Dependency: Depends on placeholderStyles.ts. Batch A. Tests: `shared/ui/ErrorLine.test.tsx`. Trace: D-4, D-9, AC-1, AC-6.

#### placeholder-styles · create · `studio/src/shared/ui/placeholderStyles.ts`

Purpose: Private class constants shared by EmptyState, LoadingState and ErrorLine so the pane layout and sizes exist once.

Symbols: `PLACEHOLDER_TEXT_SIZE`, `PANE_PLACEHOLDER_LAYOUT`, `PlaceholderElement`, `PlaceholderSize`.

Responsibilities and exact work:

- `PLACEHOLDER_TEXT_SIZE`: `{ sm: "text-sm", xs: "text-xs" }`.
- `PANE_PLACEHOLDER_LAYOUT`: `flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center text-sm`.
- `PlaceholderElement`: `"div" | "p" | "span" | "li"`; `PlaceholderSize`: `"sm" | "xs"`.
- Plain exported constants and types; no React.

Preserved boundary:

- Imported only by the three placeholder components; no feature imports it.

Verification: Covered through the three component tests and typecheck.

Dependency: First file in batch A. Tests: `covered by component tests`. Trace: D-2, D-3, D-4.

#### t-section-heading · create · `studio/src/shared/ui/SectionHeading.test.tsx`

Purpose: Behaviour test for SectionHeading.

Symbols: `SectionHeading`.

Responsibilities and exact work:

- title with as h2 is `getByRole("heading", { level: 2, name })`.
- eyebrow default is a level-3 heading; `as="span"` produces no heading role.
- section with `count={3}` renders the label and the text 3; without `count` only the label renders; `count={0}` still renders 0.
- `as="label"` with `htmlFor` labels an input (`getByLabelText`).
- `id` and `role="presentation"` reach the element.
- vitest plus @testing-library/react, colocated.

Preserved boundary:

- Asserts no class strings.

Verification: `npm run test --workspace @worktracker/studio -- src/shared/ui/SectionHeading.test.tsx`.

Dependency: Batch A. Tests: `self`. Trace: AC-1.

#### t-empty-state · create · `studio/src/shared/ui/EmptyState.test.tsx`

Purpose: Behaviour test for EmptyState.

Symbols: `EmptyState`.

Responsibilities and exact work:

- Renders children verbatim with no role by default.
- Passes `role="status"` and `data-testid` through.
- `as="li"` inside a `ul` renders a listitem; pane variant renders an action button child.
- vitest plus @testing-library/react, colocated.

Preserved boundary:

- Asserts no class strings.

Verification: File passes.

Dependency: Batch A. Tests: `self`. Trace: AC-1.

#### t-loading-state · create · `studio/src/shared/ui/LoadingState.test.tsx`

Purpose: Behaviour test for LoadingState.

Symbols: `LoadingState`.

Responsibilities and exact work:

- `getByRole("status")` has text content exactly `Loading issue…` for `label="Loading issue"`.
- pane variant and `as="span"` keep role status.
- `data-testid` passes through.
- vitest plus @testing-library/react, colocated.

Preserved boundary:

- Asserts no class strings.

Verification: File passes.

Dependency: Batch A. Tests: `self`. Trace: AC-1, AC-5.

#### t-error-line · create · `studio/src/shared/ui/ErrorLine.test.tsx`

Purpose: Behaviour test for ErrorLine.

Symbols: `ErrorLine`.

Responsibilities and exact work:

- inline, banner and pane variants each expose `getByRole("alert")` with the children text.
- A retry button child is reachable by role and clickable.
- `id` and `aria-label` pass through.
- vitest plus @testing-library/react, colocated.

Preserved boundary:

- Asserts no class strings.

Verification: File passes.

Dependency: Batch A. Tests: `self`. Trace: AC-1, AC-6.

#### t-settings-primitives · create · `studio/src/shared/ui/SettingsPrimitives.test.tsx`

Purpose: Pins the SettingsStatusLine-to-ErrorLine delegation and the rebuilt SettingsSubsection headings.

Symbols: `SettingsStatusLine`, `SettingsSubsection`.

Responsibilities and exact work:

- tone danger exposes role alert; tones success and attention expose role status.
- SettingsSubsection headingRole section renders a level-2 heading; default renders a level-3 heading.
- vitest plus @testing-library/react, colocated.

Preserved boundary:

- Does not cover settingsButtonClass or SETTINGS_FIELD_CLASS (tickets 05 and 06).

Verification: File passes.

Dependency: Batch E (delegation) and batch B (subsection). Tests: `self`. Trace: D-5, AC-1.

#### settings-primitives · modify · `studio/src/shared/ui/SettingsPrimitives.tsx`

Purpose: Lose the two heading constants; SettingsStatusLine routes its danger tone to ErrorLine; SettingsSubsection renders SectionHeading.

Symbols: `SETTINGS_SECTION_HEADING_CLASS (delete)`, `SETTINGS_EYEBROW_CLASS (delete)`, `SettingsStatusLine`, `STATUS_TONE_CLASS`, `SettingsSubsection`.

Responsibilities and exact work:

- SettingsStatusLine keeps `tone: "success" | "attention" | "danger"` for the three dynamic callers. tone danger returns `<ErrorLine variant="banner" className={className} {...props}>`; other tones render the existing div with `role="status"`.
- SettingsSubsection renders `SectionHeading level="title" as="h2"` for headingRole section and `SectionHeading level="eyebrow" as="h3"` otherwise.
- Delete `SETTINGS_SECTION_HEADING_CLASS` and `SETTINGS_EYEBROW_CLASS` after batch B removes every import.
- Remove the `danger` entry from `STATUS_TONE_CLASS` (type it as `Record<"success" | "attention", string>`).
- Change `SettingsStatusLineProps` to extend `Omit<HTMLAttributes<HTMLDivElement>, "role">` (no caller passes role).

Preserved boundary:

- Leaves `SETTINGS_FIELD_CLASS`, `SETTINGS_CHECKBOX_CLASS` and `settingsButtonClass` alone (tickets 05 and 06 remove them).

Verification: `grep -rn "SETTINGS_EYEBROW_CLASS\|SETTINGS_SECTION_HEADING_CLASS" studio/src` is empty. SettingsPrimitives.test.tsx passes.

Dependency: Constant deletion after batch B; delegation in batch E. Tests: `shared/ui/SettingsPrimitives.test.tsx`, `overhaulProviderSettingsAcceptance`. Trace: D-5, AC-2.

#### h-settings-modal · modify · `studio/src/features/studio/modals/SettingsModal.tsx`

Purpose: Settings shell headings and loading fallback move onto shared components.

Symbols: `SettingsModal`, `AppliedChangesLedger`.

Responsibilities and exact work:

- :152 h2 Models becomes `SectionHeading level="title" as="h2"`.
- :256 `Applied` div becomes `SectionHeading level="eyebrow" as="div"`.
- :293 ledger `{entry.section}` span becomes `SectionHeading level="eyebrow" as="span"`.
- :160 Suspense fallback becomes `LoadingState as="p" label="Loading model configuration"` (batch D).
- :137 dynamic `SettingsStatusLine tone={modelStatus.tone}` stays; it now delegates danger to ErrorLine.
- Drop the `SETTINGS_EYEBROW_CLASS` and `SETTINGS_SECTION_HEADING_CLASS` imports.

Preserved boundary:

- The h1 Settings title (:446) and the rail (ticket 04) are untouched.

Verification: overhaulSettingsNativeOcclusionAcceptance and overhaulProviderSettingsAcceptance pass unchanged.

Dependency: Batch B (headings) and D (loading). Tests: `src/test/overhaulProviderSettingsAcceptance.test.tsx`. Trace: AC-2, AC-5.

#### h-settings-misc · modify · `studio/src/features/studio/modals/KeyboardSettingsPanel.tsx`

Purpose: Bindings title and the column-header row use SectionHeading.

Symbols: `KeyboardSettingsPanel`.

Responsibilities and exact work:

- :179 h2 Bindings becomes `SectionHeading level="title" as="h2"`.
- :217 the grid header row keeps its container div with `grid grid-cols-[minmax(12rem,1fr)_8rem_12rem_5rem] gap-3 border-b border-pane-border px-3 py-2` and drops its text classes; each of its four spans becomes `SectionHeading level="eyebrow" as="span"` (Reset keeps `className="text-right"`).
- :209 dynamic `SettingsStatusLine` stays.
- Drop the `SETTINGS_SECTION_HEADING_CLASS` import.

Preserved boundary:

- Search input styling belongs to ticket 06.

Verification: Keyboard settings tests pass unchanged.

Dependency: Batch B. Tests: `existing keyboard settings suites`. Trace: AC-2.

#### h-keybinding-settings · modify · `studio/src/features/studio/modals/KeybindingSettings.tsx`

Purpose: Keyboard shortcuts title uses SectionHeading.

Symbols: `KeybindingSettings`.

Responsibilities and exact work:

- :144 h2 becomes `SectionHeading level="title" as="h2"`.
- Drop the `SETTINGS_SECTION_HEADING_CLASS` import.

Preserved boundary:

- No behaviour change.

Verification: Typecheck.

Dependency: Batch B. Tests: `typecheck`. Trace: AC-2.

#### h-instant-settings · modify · `studio/src/features/settings/instant/InstantSettingsPanel.tsx`

Purpose: Conversations title uses SectionHeading.

Symbols: `InstantSettingsPanel`.

Responsibilities and exact work:

- :96 h2 becomes `SectionHeading level="title" as="h2"`.
- :104 dynamic `SettingsStatusLine tone={message.tone}` stays.
- Drop the `SETTINGS_SECTION_HEADING_CLASS` import.

Preserved boundary:

- No behaviour change.

Verification: Typecheck; settings suites.

Dependency: Batch B. Tests: `typecheck`. Trace: AC-2.

#### h-app-updates · modify · `studio/src/features/app-updates/AppUpdatesSection.tsx`

Purpose: App updates heading and its two hand-built danger banners.

Symbols: `AppUpdatesHeading`, `AppUpdatesSection`.

Responsibilities and exact work:

- :10 h2 keeps `id="app-updates-heading"` and becomes `SectionHeading level="title" as="h2"`.
- :76 and :86 p banners become `ErrorLine variant="banner" as="p" className="mt-4"` with unchanged text (batch E).
- Drop the `SETTINGS_SECTION_HEADING_CLASS` import.

Preserved boundary:

- The restart status line (:72) stays as is.

Verification: overhaulAppUpdatesAcceptance passes unchanged (findByRole alert texts).

Dependency: Batch B and E. Tests: `src/test/overhaulAppUpdatesAcceptance.test.tsx`. Trace: AC-2, AC-6.

#### h-state-launch · modify · `studio/src/features/workflows/StateLaunchConfiguration.tsx`

Purpose: Two h4 eyebrows and the control error banner.

Symbols: `StateLaunchConfiguration`.

Responsibilities and exact work:

- :55 and :95 h4 become `SectionHeading level="eyebrow" as="h4"`.
- :44 `SettingsStatusLine tone="danger"` becomes `ErrorLine variant="banner" className="mt-1"`.
- Drop `SETTINGS_EYEBROW_CLASS` and `SettingsStatusLine` imports.

Preserved boundary:

- Launch form behaviour unchanged.

Verification: Workflow suites pass.

Dependency: Batch B and E. Tests: `overhaulWorkflow* suites`. Trace: AC-2, AC-6.

#### h-transition-disclosure · modify · `studio/src/features/workflows/TransitionDisclosure.tsx`

Purpose: Transition properties eyebrow and error banner.

Symbols: `TransitionDisclosure`.

Responsibilities and exact work:

- :71 h4 becomes `SectionHeading level="eyebrow" as="h4"`.
- :106 danger line becomes `ErrorLine variant="banner" className="mt-1"`.
- Drop `SETTINGS_EYEBROW_CLASS` and `SettingsStatusLine` imports.

Preserved boundary:

- Chip at :56 belongs to ticket 11.

Verification: Workflow suites pass.

Dependency: Batch B and E. Tests: `overhaulWorkflow* suites`. Trace: AC-2, AC-6.

#### h-state-config · modify · `studio/src/features/workflows/StateConfigurationPanel.tsx`

Purpose: Overlay eyebrow, four titles, direction label, loading, empty and six error banners.

Symbols: `StateConfigurationPanel`.

Responsibilities and exact work:

- :122 p eyebrow becomes `SectionHeading level="eyebrow" as="p"`; :401 span becomes `as="span"`.
- :222, :245, :311, :385 h2 become `SectionHeading level="title" as="h2"`.
- :141 becomes `LoadingState as="p" className="mt-4" label="Loading workflow policy"`.
- :143 and :457 become `EmptyState as="p"` (the first with `className="mt-4"`), copy unchanged.
- :137 becomes `ErrorLine variant="banner" className="mt-4"`; :349, :352, :443, :448 become `ErrorLine variant="banner"`.
- :174 `SettingsStatusLine tone="attention"` stays.
- File is 461 lines; the swaps must not increase its length. No extraction is required by this ticket.

Preserved boundary:

- The h1 state title and the header layout move to PaneOverlay in ticket 09; pill tabs at :223-241 belong to ticket 04.

Verification: State configuration suites pass unchanged.

Dependency: Batches B, C, D, E. Tests: `overhaulWorkflow* suites`. Trace: AC-2, AC-5, AC-6.

#### h-conversation-config · modify · `studio/src/features/settings/instant/ConversationConfigurationPanel.tsx`

Purpose: Overlay eyebrow uses SectionHeading.

Symbols: `ConversationConfigurationPanel`.

Responsibilities and exact work:

- :13 p becomes `SectionHeading level="eyebrow" as="p"`.
- Single swap.

Preserved boundary:

- Overlay chrome is unified by PaneOverlay in ticket 09, which must render this eyebrow through SectionHeading.

Verification: Typecheck.

Dependency: Batch B. Tests: `typecheck`. Trace: AC-2.

#### h-onboarding-providers · modify · `studio/src/app/onboarding/OnboardingProviders.tsx`

Purpose: Legend eyebrow, loading line and error line.

Symbols: `OnboardingProviders`.

Responsibilities and exact work:

- :196 legend becomes `SectionHeading level="eyebrow" as="legend"`.
- :192 becomes `LoadingState as="p" className="mt-7" label="Loading providers"`.
- :244 becomes `ErrorLine as="p" className="mt-4"`.
- Three swaps.

Preserved boundary:

- Provider toggles untouched.

Verification: overhaulProviderSettingsAcceptance `getByText("Loading providers…")` and alert assertions pass unchanged.

Dependency: Batches B, D, E. Tests: `src/test/overhaulProviderSettingsAcceptance.test.tsx`. Trace: AC-2, AC-5, AC-6.

#### h-add-module · modify · `studio/src/features/studio/modals/AddModule.tsx`

Purpose: Two label eyebrows and two red error lines.

Symbols: `AddModule`.

Responsibilities and exact work:

- :172 label becomes `SectionHeading level="eyebrow" as="label" htmlFor={moduleNameId}`.
- :195 label becomes the same with `htmlFor={moduleFolderId}` and `className="mb-2 block"`.
- :217 becomes `ErrorLine id={moduleFolderErrorId} className="mt-2"`; :224 becomes `ErrorLine className="mt-2"`.
- Remove both `text-red-400` usages.

Preserved boundary:

- Primary button (ticket 05) and input (ticket 06) untouched.

Verification: overhaulOnboardingModuleAcceptance passes; `getByLabelText("Module name")` still resolves.

Dependency: Batches B and E. Tests: `src/test/overhaulOnboardingModuleAcceptance.test.tsx`. Trace: AC-2, AC-3, AC-6.

#### h-module-folder-selection · modify · `studio/src/features/agents/terminal/ModuleFolderSelection.tsx`

Purpose: Recent folders eyebrow and error line.

Symbols: `ModuleFolderSelection`.

Responsibilities and exact work:

- :124 div becomes `SectionHeading level="eyebrow" as="div" className="mb-1"`.
- :118 becomes `ErrorLine as="p" size="xs" className="mt-2"`.
- Two swaps.

Preserved boundary:

- Folder list behaviour unchanged.

Verification: overhaulModuleSelectionAcceptance passes.

Dependency: Batches B and E. Tests: `src/test/overhaulModuleSelectionAcceptance.test.tsx`. Trace: AC-2, AC-6.

#### h-shortcuts-modal · modify · `studio/src/features/studio/modals/KeyboardShortcutsModal.tsx`

Purpose: Two section eyebrows and the table header labels.

Symbols: `KeyboardShortcutsModal`.

Responsibilities and exact work:

- :88 h3 (id keyboard-shortcuts-essentials) becomes `SectionHeading level="eyebrow" as="h3"` keeping the id.
- :109 h3 (id keyboard-shortcuts-all): wrap in `<div className="border-t border-pane-border pt-3">` and render `SectionHeading level="eyebrow" as="h3"` inside, keeping the id.
- :133 thead keeps `sticky top-0 bg-pane-title` and drops its text classes; each th keeps `scope="col" className="px-3 py-2"` and wraps its text in `SectionHeading level="eyebrow" as="span"`.
- `aria-labelledby` references keep resolving because ids stay on the h3.

Preserved boundary:

- Filter input belongs to ticket 06.

Verification: Keyboard shortcuts suites pass; th column headers keep their accessible names.

Dependency: Batch B. Tests: `existing keyboard shortcut suites`. Trace: AC-2.

#### h-branch-inspector · modify · `studio/src/features/agents/worktrees/changes/BranchInspector.tsx`

Purpose: Branch eyebrow.

Symbols: `BranchInspector`.

Responsibilities and exact work:

- :91 h2 becomes `SectionHeading level="eyebrow" as="h2"`.
- Single swap.

Preserved boundary:

- Busy button labels (Committing..., Pushing...) are excluded (E-3).

Verification: overhaulModuleVersionControlAcceptance passes.

Dependency: Batch B. Tests: `src/test/overhaulModuleVersionControlAcceptance.test.tsx`. Trace: AC-2.

#### h-worktree-switcher · modify · `studio/src/features/agents/worktrees/changes/WorktreeSwitcher.tsx`

Purpose: Popover eyebrow, failure, loading and empty lines.

Symbols: `WorktreeSwitcher`.

Responsibilities and exact work:

- :127 h2 becomes `SectionHeading level="eyebrow" as="h2"`.
- :159 becomes `ErrorLine as="p" size="xs" className="px-3 py-2"`.
- :160 becomes `LoadingState as="p" size="xs" className="px-3 py-2" label="Loading worktree checkouts"`.
- :161 becomes `EmptyState as="p" size="xs" className="px-3 py-2"`, text `No current task worktrees.` unchanged.
- Four swaps inside the existing ternary.

Preserved boundary:

- Trigger label `Loading checkouts...` (:120) is excluded (E-3). Listbox migration is ticket 08; the truncated status line stays.

Verification: overhaulWorktreeSwitcherFailureAcceptance and overhaulModuleVersionControlAcceptance (`No current task worktrees.`) pass unchanged.

Dependency: Batches B to E. Tests: `src/test/overhaulWorktreeSwitcherFailureAcceptance.test.tsx`. Trace: AC-2, AC-5, AC-6.

#### h-markdown-editor · modify · `studio/src/features/documents/MarkdownDocumentEditor.tsx`

Purpose: Comparison eyebrows and the two Save failed lines.

Symbols: `MarkdownDocumentEditor`.

Responsibilities and exact work:

- :148 and :156 h3 become `SectionHeading level="eyebrow" as="h3" className="mb-2"`.
- :113 and :123 spans become `ErrorLine as="span" size="xs"` with text `Save failed`.
- Four swaps.

Preserved boundary:

- The conflict notice at :65 (attention tone with actions) and the blue Save button (ticket 05) are untouched.

Verification: overhaulDocumentSaveRuntimeAcceptance passes unchanged.

Dependency: Batches B and E. Tests: `src/test/overhaulDocumentSaveRuntimeAcceptance.test.tsx`. Trace: AC-2, AC-6.

#### h-work-item-search · modify · `studio/src/features/work-items/WorkItemSearchList.tsx`

Purpose: Delete private GroupHeading; empty row uses EmptyState.

Symbols: `GroupHeading (delete)`, `WorkItemSearchList`.

Responsibilities and exact work:

- :73 and :80 `<GroupHeading>` become `SectionHeading level="eyebrow" as="div" className="px-3 pb-0.5 pt-2"`.
- :89 empty div becomes `EmptyState className="px-3 py-2"`, copy unchanged.
- Delete `GroupHeading` (:98-104). Keep the `ReactNode` import; `taskLeading` still uses it.

Preserved boundary:

- Private `Identifier` stays for ticket 12.

Verification: WorkItemSearchList.test.tsx passes; `grep -rn "GroupHeading" studio/src` is empty.

Dependency: Batches B and C. Tests: `src/features/work-items/WorkItemSearchList.test.tsx`. Trace: AC-2.

#### h-dormant-tabs · modify · `studio/src/app/shell/ticket-workspace/selected-ticket/internal/DormantWorkspaceTabs.tsx`

Purpose: Menu section labels use SectionHeading.

Symbols: `sectionClassName (delete)`, `DormantWorkspaceTabs`.

Responsibilities and exact work:

- :181, :203, :223 `<div role="presentation" className={sectionClassName}>` become `SectionHeading level="eyebrow" as="div" role="presentation" className="px-3 pb-0.5 pt-1.5"`.
- Delete the `sectionClassName` constant (:35-36). Size moves from `text-[10px]` to `text-xs`.

Preserved boundary:

- Menu, trigger and count chip belong to tickets 05, 07, 08 and 11.

Verification: overhaulDormantWorkspaceTabsAcceptance passes unchanged.

Dependency: Batch B. Tests: `src/test/overhaulDormantWorkspaceTabsAcceptance.test.tsx`. Trace: AC-2.

#### h-modal-shell · modify · `studio/src/app/modal/ModalShell.tsx`

Purpose: Modal title eyebrow.

Symbols: `ModalShell`.

Responsibilities and exact work:

- :127 title div becomes `SectionHeading level="eyebrow" as="div"`.
- Single swap; colour moves from text-text-muted to text-text-secondary and size from text-sm to text-xs.

Preserved boundary:

- Focus trap, Escape and close button (tickets 01 and 09) untouched.

Verification: Every ModalShell suite passes; dialogs keep their aria-label.

Dependency: Batch B. Tests: `overhaul modal suites`. Trace: AC-2.

#### h-modal-error-boundary · modify · `studio/src/app/modal/ModalErrorBoundary.tsx`

Purpose: Error card heading.

Symbols: `ModalErrorBoundary`.

Responsibilities and exact work:

- :67 h2 becomes `SectionHeading level="eyebrow" as="h2"`.
- Single swap.

Preserved boundary:

- The card keeps its own `role="alert"`; it is a dialog-sized failure card, not an ErrorLine.

Verification: overhaulModalLoadFailureAcceptance passes unchanged.

Dependency: Batch B. Tests: `src/test/overhaulModalLoadFailureAcceptance.test.tsx`. Trace: AC-2.

#### h-detail-sections · modify · `studio/src/app/shell/ticket-workspace/selected-ticket/details/ChildIssues.tsx`

Purpose: Child issues section heading with count and the empty row.

Symbols: `ChildIssues`.

Responsibilities and exact work:

- :32-37 header becomes `SectionHeading level="section" className="mb-2" count={children.length}>Child issues</SectionHeading>`.
- :41 becomes `EmptyState className="px-3 py-2"` with `No sub-tasks yet.`.
- Two swaps.

Preserved boundary:

- Rows (ticket 12), select and input (ticket 06) untouched; `data-testid="child-issues"` stays on the list container.

Verification: overhaulTaskWorkspaceIdentifierAcceptance passes unchanged.

Dependency: Batches B and C. Tests: `src/test/overhaulTaskWorkspaceIdentifierAcceptance.test.tsx`. Trace: AC-2.

#### h-attachments · modify · `studio/src/app/shell/ticket-workspace/selected-ticket/details/Attachments.tsx`

Purpose: Attachments section heading with count.

Symbols: `Attachments`.

Responsibilities and exact work:

- :12-17 header becomes `SectionHeading level="section" className="mb-2" count={attachments.length}>Attachments</SectionHeading>`.
- Single swap.

Preserved boundary:

- `data-testid="attachments"` and rows unchanged.

Verification: Detail suites pass.

Dependency: Batch B. Tests: `overhaulWorkItem* suites`. Trace: AC-2.

#### h-findings · modify · `studio/src/app/shell/ticket-workspace/selected-ticket/details/FindingsPanel.tsx`

Purpose: Review findings section heading; the queued chip rides in `count`.

Symbols: `FindingsPanel`.

Responsibilities and exact work:

- :38-45 header becomes `SectionHeading level="section" className="mb-2" count={<span data-testid="findings-queued-count" className="bg-pane-title px-2 py-0.5 text-text-secondary">{queued} {queued === 1 ? "fix" : "fixes"} queued</span>}>Review findings</SectionHeading>`.
- Single swap; testid and text preserved.

Preserved boundary:

- Ticket 11 later replaces the inner span with `Chip` count; rows belong to ticket 12.

Verification: Findings suites pass; `getByTestId("findings-queued-count")` still finds the text.

Dependency: Batch B. Tests: `overhaul findings suites`. Trace: AC-2.

#### h-field · modify · `studio/src/app/shell/ticket-workspace/selected-ticket/details/Field.tsx`

Purpose: Field label uses the eyebrow style with muted tone.

Symbols: `Field`.

Responsibilities and exact work:

- :23-30 label span becomes `SectionHeading level="eyebrow" as="span" data-testid="field-label" tone={muted ? "muted" : "secondary"}>{label}</SectionHeading>`.
- Single swap.

Preserved boundary:

- Value wrapper, `aria-busy` and `data-testid` hooks unchanged.

Verification: Detail field suites pass.

Dependency: Batch B. Tests: `overhaulWorkItem* suites`. Trace: AC-2.

#### h-titles-workflows · modify · `studio/src/features/workflows/StateCatalog.tsx`

Purpose: Delete-confirm title, loading line and two danger banners.

Symbols: `StateCatalog`.

Responsibilities and exact work:

- :127 h2 becomes `SectionHeading level="title" as="h2"`.
- :130 becomes `LoadingState as="p" className="mt-2" label="Loading impact"`.
- :132 and :137 become `ErrorLine variant="banner" className="mt-3"` (the second keeps its paragraph and Refresh impact button as children).
- Drop the `SettingsStatusLine` import.

Preserved boundary:

- Dialog shell moves to ConfirmDialog/ModalShell in ticket 09; buttons in ticket 05.

Verification: State catalog suites pass.

Dependency: Batches B, D, E. Tests: `overhaulWorkflow* suites`. Trace: AC-2, AC-5, AC-6.

#### h-impact-dialog · modify · `studio/src/features/workflows/WorkflowImpactDialog.tsx`

Purpose: Impact dialog title.

Symbols: `WorkflowImpactDialog`.

Responsibilities and exact work:

- :35 h2 becomes `SectionHeading level="title" as="h2"`.
- Single swap.

Preserved boundary:

- Dialog shell is ticket 09.

Verification: Typecheck; workflow suites.

Dependency: Batch B. Tests: `overhaulWorkflow* suites`. Trace: AC-2.

#### h-coach-mark · modify · `studio/src/app/onboarding/CoachMark.tsx`

Purpose: Coach mark title.

Symbols: `CoachMark`.

Responsibilities and exact work:

- :211 h2 keeps `id={titleId}` and becomes `SectionHeading level="title" as="h2"`.
- Single swap.

Preserved boundary:

- Placement and focus unchanged.

Verification: Onboarding suites pass.

Dependency: Batch B. Tests: `overhaulOnboarding* suites`. Trace: AC-2.

#### h-issue-types · modify · `studio/src/features/workflows/IssueTypesSection.tsx`

Purpose: Issue type title, split loading/empty paragraph and the InlineError helper.

Symbols: `IssueTypesSection`, `InlineError`.

Responsibilities and exact work:

- :298 h3 becomes `SectionHeading level="title" as="h3" className="min-w-0 flex-1"`.
- :216-220 the combined paragraph splits: `action?.startsWith("load:")` renders `LoadingState as="p" label="Loading issue type workflow"`, otherwise `EmptyState as="p"` with `No issue type workflow is configured.`.
- `InlineError` (:472-478) keeps its signature and renders `ErrorLine variant="banner" className="mt-1"`.
- Drop the `SettingsStatusLine` import.

Preserved boundary:

- State dot at :295 belongs to ticket 11.

Verification: Issue type workflow suites pass.

Dependency: Batches B to E. Tests: `overhaulWorkflow* suites`. Trace: AC-2, AC-5, AC-6.

#### h-story-guide · modify · `studio/src/features/workflows/StoryWorkflowGuideDialog.tsx`

Purpose: Four guide titles, two loading lines and three error lines.

Symbols: `StoryWorkflowGuideDialog`.

Responsibilities and exact work:

- :80, :117, :138, :148 h3 keep their ids and become `SectionHeading level="title" as="h3"`.
- :106 becomes `LoadingState as="p" label="Loading provider configuration"`; :123 becomes `LoadingState as="p" label="Loading workflow"`.
- :86, :119, :125 become `ErrorLine` (div) with their text and Retry buttons as children.
- Nine swaps.

Preserved boundary:

- Close button belongs to ticket 05.

Verification: overhaulStoryWorkflowGuideAcceptance passes unchanged (alert and `Loading workflow` status assertions).

Dependency: Batches B, D, E. Tests: `src/test/overhaulStoryWorkflowGuideAcceptance.test.tsx`. Trace: AC-2, AC-5, AC-6.

#### h-prototypes · modify · `studio/src/features/conversations/prototype/ConversationInboxVariant.tsx`, `studio/src/features/conversations/prototype/ConversationTimelineVariant.tsx`

Purpose: Trivial swaps only in the conversation prototypes.

Symbols: `ConversationInboxVariant`, `ConversationTimelineVariant`.

Responsibilities and exact work:

- ConversationInboxVariant.tsx :354 and :378 h3 (ids kept) become `SectionHeading level="eyebrow" as="h3"`.
- ConversationTimelineVariant.tsx :158-160 h3 (id kept) becomes `SectionHeading level="eyebrow" as="h3"`; :129 h2 Chats becomes `SectionHeading level="title" as="h2"`.
- Skip any swap that is not a one-element replacement.

Preserved boundary:

- ConversationInboxVariant.tsx :330 (attention-coloured heading) and :311 (`text-md`) stay; prototypes never gate this ticket.

Verification: Typecheck.

Dependency: Batch B, optional. Tests: `typecheck`. Trace: AC-2.

#### e-pickers · modify · `studio/src/app/shell/ticket-workspace/selected-ticket/details/fields/StatePicker.tsx`, `studio/src/app/shell/ticket-workspace/selected-ticket/details/WorkflowStatePicker.tsx`, `studio/src/app/shell/ticket-workspace/selected-ticket/details/fields/IssueTypePicker.tsx`

Purpose: Popover empty rows in the three detail pickers.

Symbols: `StatePicker`, `WorkflowStatePicker`, `IssueTypePicker`.

Responsibilities and exact work:

- fields/StatePicker.tsx :62, WorkflowStatePicker.tsx :84 and fields/IssueTypePicker.tsx :49-51 each become `EmptyState className="px-3 py-2"` with copy unchanged (`No permitted transitions`, `No permitted transitions`, `No task issue types.`).
- Three files, one swap each.

Preserved boundary:

- `Dot` components belong to ticket 11; Popover to ticket 07.

Verification: Picker suites pass.

Dependency: Batch C. Tests: `overhaulTransitionLandingAcceptance`. Trace: AC-2.

#### e-merge-dest · modify · `studio/src/features/agents/worktrees/changes/MergeDestinationPicker.tsx`

Purpose: No matching branches row.

Symbols: `MergeDestinationPicker`.

Responsibilities and exact work:

- :109 li becomes `EmptyState as="li" role="presentation" size="xs" className="px-2 py-2"`, text `No matching branches` unchanged.
- Single swap.

Preserved boundary:

- Listbox migration is ticket 08.

Verification: overhaulTaskWorktreeChangesAcceptance `getByText("No matching branches")` passes.

Dependency: Batch C. Tests: `src/test/overhaulTaskWorktreeChangesAcceptance.test.tsx`. Trace: AC-2.

#### e-panes · modify · `studio/src/app/shell/sidebar/modules/ModulesPane.tsx`

Purpose: Modules pane loading and empty lines.

Symbols: `ModulesPane`.

Responsibilities and exact work:

- :70 `…` div becomes `LoadingState label="Loading modules"`.
- :73 becomes `EmptyState` with `No modules`.
- Two swaps.

Preserved boundary:

- Add module button unchanged.

Verification: Module pane suites pass.

Dependency: Batches C and D. Tests: `overhaulModuleVisibilityAcceptance`. Trace: AC-2, AC-5.

#### e-tasks-pane · modify · `studio/src/app/shell/ticket-workspace/tasks/TasksPane.tsx`

Purpose: Stories pane loading and empty lines.

Symbols: `TasksPane`.

Responsibilities and exact work:

- :455 `…` div becomes `LoadingState label="Loading stories"`.
- :457 becomes `EmptyState` with `No stories`.
- Two swaps; the file is 465 lines and must not grow.

Preserved boundary:

- Tree rows and StateHeaderRow are out of scope.

Verification: overhaulWorkItemAcceptance with the one updated assertion (see test record).

Dependency: Batches C and D. Tests: `src/test/overhaulWorkItemAcceptance.test.tsx`. Trace: AC-2, AC-5.

#### e-stories-search · modify · `studio/src/app/shell/ticket-workspace/tasks/components/StoriesSearchEmptyState.tsx`

Purpose: Search no-match message.

Symbols: `StoriesSearchEmptyState`.

Responsibilities and exact work:

- :15 p becomes `EmptyState as="p" role="status" aria-live="polite"` with the same text.
- Single swap.

Preserved boundary:

- Bordered container and Clear search button unchanged.

Verification: overhaulWorkItemRowAcceptance `findByRole("status")` text passes.

Dependency: Batch C. Tests: `src/test/overhaulWorkItemRowAcceptance.test.tsx`. Trace: AC-2.

#### e-selected · modify · `studio/src/app/shell/ticket-workspace/selected-ticket/SelectedTicketContent.tsx`, `studio/src/app/shell/ticket-workspace/selected-ticket/details/SelectedTicketDetails.tsx`

Purpose: No task selected lines.

Symbols: `SelectedTicketContent`, `SelectedTicketDetails`.

Responsibilities and exact work:

- SelectedTicketContent.tsx :350 and details/SelectedTicketDetails.tsx :18 become `EmptyState` with `No task selected`.
- Two files, one swap each.

Preserved boundary:

- No behaviour change.

Verification: Selection suites pass.

Dependency: Batch C. Tests: `overhaulEditViewNavigationAcceptance`. Trace: AC-2.

#### e-status-parent · modify · `studio/src/features/studio/modals/StatusUpdate.tsx`, `studio/src/features/studio/modals/ParentUpdate.tsx`

Purpose: Status and parent modal empty and saving lines.

Symbols: `StatusUpdate`, `ParentUpdate`.

Responsibilities and exact work:

- StatusUpdate.tsx :83 becomes `EmptyState` (`No states available`); :104 becomes `LoadingState className="mt-2" label="Saving"`.
- ParentUpdate.tsx :137-139 becomes `EmptyState` with the same ternary copy; :162 becomes `LoadingState className="mt-2" label="Saving"`.
- Two files, two swaps each.

Preserved boundary:

- List keyboard handling unchanged; input belongs to ticket 06.

Verification: overhaulReparentConvergenceAcceptance passes.

Dependency: Batches C and D. Tests: `src/test/overhaulReparentConvergenceAcceptance.test.tsx`. Trace: AC-2, AC-5.

#### e-workflow-misc · modify · `studio/src/features/workflows/WorkflowSettingsPanel.tsx`, `studio/src/features/workflows/StoryWorkflowGuideStages.tsx`

Purpose: Workflow settings select-a-project and loading lines, plus the guide stages notes.

Symbols: `WorkflowSettingsPanel`, `StoryWorkflowGuideStages`.

Responsibilities and exact work:

- WorkflowSettingsPanel.tsx :25 becomes `EmptyState as="p"`; :28 becomes `LoadingState as="span" label="Loading workflow"`.
- StoryWorkflowGuideStages.tsx :66 becomes `EmptyState as="p" className="mt-2"`; :13 becomes `ErrorLine as="p" className="mt-1"` (adds role alert).
- Two files.

Preserved boundary:

- Stage content and copy unchanged.

Verification: overhaulStoryWorkflowGuideAcceptance `toHaveTextContent("Current state is outside...")` passes.

Dependency: Batches C to E. Tests: `src/test/overhaulStoryWorkflowGuideAcceptance.test.tsx`. Trace: AC-2, AC-5, AC-6.

#### e-changes-review · modify · `studio/src/features/agents/worktrees/changes/ChangesFileReview.tsx`

Purpose: Diff region placeholders.

Symbols: `ChangesFileReview`.

Responsibilities and exact work:

- :171 becomes `EmptyState as="p"`; :173 binary note and :176 `No textual changes to display.` become `EmptyState as="p" role="status"`.
- :170 becomes `LoadingState as="p" label="Loading diff"` (text becomes `Loading diff…`).
- :169 becomes `ErrorLine as="p"` with `Unable to load this file diff.`.
- Five swaps in the ternary.

Preserved boundary:

- `Loading changes...` count label (:103) is excluded (E-3); the truncated attention status (:174) stays.

Verification: overhaulChangesDiffKeyboardAcceptance (`findByRole("status", { name: "" })` contains `Loading diff`; alert text) and overhaulTaskWorktreeChangesAcceptance pass unchanged.

Dependency: Batches C to E. Tests: `src/test/overhaulChangesDiffKeyboardAcceptance.test.tsx`. Trace: AC-2, AC-5, AC-6.

#### p-empty-module · modify · `studio/src/app/shell/ticket-workspace/EmptyModuleWorkspace.tsx`

Purpose: Both full-pane module placeholders.

Symbols: `EmptyModuleWorkspace`.

Responsibilities and exact work:

- :16-28 becomes `EmptyState variant="pane" data-testid="empty-project-workspace"` with the paragraph and + Add Module button as children.
- :30-40 becomes `EmptyState variant="pane" data-testid="empty-module-workspace"` with the existing ternary copy.
- Two swaps; px-6 and gap-2 give way to the shared pane layout.

Preserved boundary:

- Add Module button styling belongs to ticket 05.

Verification: overhaulModuleVisibilityAcceptance passes unchanged.

Dependency: Batch C. Tests: `src/test/overhaulModuleVisibilityAcceptance.test.tsx`. Trace: AC-2.

#### p-issue-detail · modify · `studio/src/app/shell/ticket-workspace/selected-ticket/details/IssueDetail.tsx`

Purpose: Issue detail loading, not-found and load-error panes.

Symbols: `IssueDetail`.

Responsibilities and exact work:

- :160 becomes `LoadingState variant="pane" label="Loading issue"`.
- :164-170 becomes `EmptyState variant="pane" data-testid="issue-not-found"` with the two existing lines as children.
- :174-179 becomes `ErrorLine variant="pane" data-testid="issue-load-error"` with `apiErrorMessage(taskQuery.error)`.
- Three swaps.

Preserved boundary:

- Text size moves from text-base to text-sm; data flow unchanged.

Verification: overhaulWorkItemAcceptance `queryByText("Loading issue…")` and e2e `Loading issue…` assertions pass.

Dependency: Batches C to E. Tests: `src/test/overhaulWorkItemAcceptance.test.tsx`. Trace: AC-2, AC-5, AC-6.

#### p-terminal · modify · `studio/src/features/terminal-panel/TerminalPanel.tsx`, `studio/src/features/terminal-panel/DeadShell.tsx`

Purpose: Terminal panel body placeholders.

Symbols: `TerminalPanel`, `DeadShell`.

Responsibilities and exact work:

- TerminalPanel.tsx :97 becomes `EmptyState variant="pane" data-testid="terminal-panel-empty"`; :123 becomes `EmptyState variant="pane" role="alert" data-testid="terminal-panel-failure"` with its paragraph and retry button; :177 becomes `EmptyState variant="pane" data-testid="terminal-panel-no-shells"`.
- DeadShell.tsx :20-26 becomes `EmptyState variant="pane" role="alert" data-testid="terminal-panel-dead-shell" data-exit-code={...}` with the paragraph and restart button.
- Two files.

Preserved boundary:

- `terminal-panel-pending` stays a bare panel. These two failure panes keep muted text as the ticket lists them as pane placeholders.

Verification: overhaulTerminalPanelExitAcceptance and overhaulTerminalPanelTabsAcceptance pass unchanged.

Dependency: Batch C. Tests: `src/test/overhaulTerminalPanelExitAcceptance.test.tsx`. Trace: AC-2, AC-7.

#### l-model-config · modify · `studio/src/features/workflows/ModelConfigurationPanel.tsx`

Purpose: Model configuration loading line.

Symbols: `ModelConfigurationPanel`.

Responsibilities and exact work:

- :317 becomes `LoadingState as="p" label="Loading model configuration"`.
- Single swap.

Preserved boundary:

- SettingsSubsection callers unchanged.

Verification: Provider settings suites pass.

Dependency: Batch D. Tests: `overhaulProviderSettingsAcceptance`. Trace: AC-5.

#### l-merge-preview · modify · `studio/src/features/agents/worktrees/changes/WorktreeMergePreview.tsx`

Purpose: Merge preview loading and the four-plus error lines.

Symbols: `WorktreeMergePreview`.

Responsibilities and exact work:

- :190 becomes `LoadingState as="p" size="xs" label="Loading local merge preview"`; :326 becomes `LoadingState as="p" size="xs" className="mt-2" label="Loading destination preview"`.
- :189 becomes `ErrorLine as="p" size="xs"` (adds role alert); :307, :327, :339, :352 become `ErrorLine as="p" size="xs" className="mt-2"`.
- Seven swaps.

Preserved boundary:

- Unmerged files list (:215) and danger buttons (:250) untouched; busy labels excluded (E-3).

Verification: overhaulWorktreeMergeRecoveryAcceptance passes unchanged.

Dependency: Batches D and E. Tests: `src/test/overhaulWorktreeMergeRecoveryAcceptance.test.tsx`. Trace: AC-5, AC-6.

#### l-modal-host · modify · `studio/src/app/modal/ModalHost.tsx`

Purpose: Lazy modal fallback.

Symbols: `ModalLoadingFallback`.

Responsibilities and exact work:

- :45-51 the card div keeps `border border-pane-border bg-pane-panel px-4 py-3` without a role and contains `LoadingState label={`Loading ${label}`}`.
- Single swap; role moves to the inner element.

Preserved boundary:

- Scrim and Suspense wiring unchanged.

Verification: overhaulModalLoadFailureAcceptance `getByRole("status")` passes unchanged.

Dependency: Batch D. Tests: `src/test/overhaulModalLoadFailureAcceptance.test.tsx`. Trace: AC-5.

#### l-handoff · modify · `studio/src/app/onboarding/StoryHandoffGuidance.tsx`

Purpose: Onboarding checking lines.

Symbols: `StoryHandoffGuidance`, `StoryLaunchGuidance`.

Responsibilities and exact work:

- :23 becomes `LoadingState as="p" label="Checking this Story's launch configuration"`; :53 becomes `LoadingState as="p" label="Checking provider configuration"`.
- Two swaps.

Preserved boundary:

- The provider-load-failure `role="status"` paragraph (:47) stays; it is guidance, not an error line.

Verification: overhaulOnboardingCompletionAcceptance passes.

Dependency: Batch D. Tests: `src/test/overhaulOnboardingCompletionAcceptance.test.tsx`. Trace: AC-5.

#### l-launch-form · modify · `studio/src/features/workflows/LaunchConfigurationForm.tsx`

Purpose: Applying line and validation banner.

Symbols: `LaunchConfigurationForm`.

Responsibilities and exact work:

- :146 becomes `LoadingState as="p" label="Applying"`.
- :142 becomes `ErrorLine variant="banner"`.
- Drop the `SettingsStatusLine` import.

Preserved boundary:

- e2e `getByText("Applying…")` count assertions keep matching.

Verification: e2e web-app Applying assertions and workflow suites pass.

Dependency: Batches D and E. Tests: `e2e/web-app.spec.ts`. Trace: AC-5, AC-6.

#### r-red-modals · modify · `studio/src/features/studio/modals/AddProject.tsx`, `studio/src/features/terminal-panel/ModuleFolderRequired.tsx`, `studio/src/features/agents/terminal/ModuleFolder.tsx`, `studio/src/features/agents/terminal/PromptInput.tsx`

Purpose: Replace the remaining text-red-400 error lines.

Symbols: `AddProject`, `ModuleFolderRequired`, `ModuleFolder`, `PromptInput`.

Responsibilities and exact work:

- AddProject.tsx :74, features/terminal-panel/ModuleFolderRequired.tsx :77, features/agents/terminal/ModuleFolder.tsx :120 and features/agents/terminal/PromptInput.tsx :78 each become `ErrorLine className="mt-2"`.
- Four files, one swap each.

Preserved boundary:

- Buttons (ticket 05) and inputs (ticket 06) untouched.

Verification: overhaulDirectoryTrustAcceptance and onboarding module suites pass; red grep is empty.

Dependency: Batch E. Tests: `src/test/overhaulDirectoryTrustAcceptance.test.tsx`. Trace: AC-3, AC-6.

#### r-worktree-errors · modify · `studio/src/features/agents/worktrees/changes/WorktreeLifecycle.tsx`, `studio/src/features/agents/worktrees/changes/ChangesActionAlert.tsx`, `studio/src/features/agents/worktrees/WorktreeBlock.tsx`, `studio/src/features/agents/worktrees/changes/ModuleVersionControl.tsx`

Purpose: Worktree lifecycle, action alert, block and module checkout errors.

Symbols: `WorktreeLifecycle`, `ChangesActionAlert`, `WorktreeBlock`, `ModuleVersionControl`.

Responsibilities and exact work:

- WorktreeLifecycle.tsx :91-98 becomes `ErrorLine variant="banner" size="xs" aria-label="Work Item closure failure"` with its two spans; :159 becomes `ErrorLine as="p" size="xs"`.
- ChangesActionAlert.tsx :17 becomes `ErrorLine as="p" size="xs"`.
- features/agents/worktrees/WorktreeBlock.tsx :380 becomes `ErrorLine as="span" size="xs"` (adds role alert).
- ModuleVersionControl.tsx :131 becomes `ErrorLine as="p" size="xs"` (role changes from status to alert).
- Four files.

Preserved boundary:

- Danger buttons, diff deletion counts and the conflict summary span (WorktreeBlock :251) untouched.

Verification: overhaulWorktreeCleanupAcceptance, overhaulChangesActionsAcceptance, overhaulModuleVersionControlAcceptance pass unchanged.

Dependency: Batch E. Tests: `src/test/overhaulWorktreeCleanupAcceptance.test.tsx`. Trace: AC-6.

#### r-documents · modify · `studio/src/features/documents/DescriptionEditor.tsx`, `studio/src/features/documents/DocViewer.tsx`

Purpose: Document error lines.

Symbols: `DescriptionEditor`, `DocViewer`.

Responsibilities and exact work:

- DescriptionEditor.tsx :233 becomes `ErrorLine as="p" size="xs" className="mt-1.5"`.
- DocViewer.tsx :267 becomes `ErrorLine variant="pane"` with `Unable to load this document.`.
- Two files.

Preserved boundary:

- Autosave behaviour unchanged.

Verification: overhaulDescriptionAutosaveAcceptance passes unchanged.

Dependency: Batch E. Tests: `src/test/overhaulDescriptionAutosaveAcceptance.test.tsx`. Trace: AC-6.

#### r-onboarding-tour · modify · `studio/src/app/onboarding/OnboardingTour.tsx`

Purpose: Tour step error.

Symbols: `OnboardingTour`.

Responsibilities and exact work:

- :76 becomes `ErrorLine as="p" className="mt-3" data-testid="onboarding-step-error"` (adds role alert).
- Single swap.

Preserved boundary:

- Tour flow unchanged.

Verification: overhaulOnboardingCompletionAcceptance `findByTestId("onboarding-step-error")` passes.

Dependency: Batch E. Tests: `src/test/overhaulOnboardingCompletionAcceptance.test.tsx`. Trace: AC-6, AC-7.

#### r-notify · modify · `studio/src/app/modal/NotifyUserModal.tsx`

Purpose: Severity badge colours move to lifecycle tokens.

Symbols: `SEVERITY_STYLES`.

Responsibilities and exact work:

- info: `border-lifecycle-idle/50 bg-lifecycle-idle/10 text-lifecycle-idle`; warning: `border-lifecycle-attention/50 bg-lifecycle-attention/10 text-lifecycle-attention`; error: `border-lifecycle-danger/50 bg-lifecycle-danger/10 text-lifecycle-danger`.
- Edit the three className strings.

Preserved boundary:

- Badge shape and `data-severity` unchanged; the badge is a chip, not an ErrorLine.

Verification: Red/blue/amber grep is empty for this file.

Dependency: Batch E. Tests: `typecheck`. Trace: AC-3, D-9.

#### r-chicklet · modify · `studio/src/features/agents/lifecycle/AutomationFailureChicklet.tsx`

Purpose: Failure chicklet colours move to lifecycle-danger.

Symbols: `AutomationFailureChicklet`.

Responsibilities and exact work:

- :48 `border-red-500/60 bg-red-500/10 ... text-red-600` becomes `border-lifecycle-danger/60 bg-lifecycle-danger/10 ... text-lifecycle-danger`; :57 `border-red-500/40 hover:bg-red-500/15` becomes `border-lifecycle-danger/40 hover:bg-lifecycle-danger/15`.
- Two className edits.

Preserved boundary:

- Badge size and structure belong to ticket 11.

Verification: Lifecycle chicklet suites pass.

Dependency: Batch E. Tests: `src/test/terminal/LifecycleBadge.test.tsx`. Trace: AC-3, D-9.

#### t-workitem-acceptance · modify · `studio/src/test/overhaulWorkItemAcceptance.test.tsx`

Purpose: The one intentional assertion change: the Stories pane loading text is no longer a bare ellipsis.

Symbols: `overhaulWorkItemAcceptance`.

Responsibilities and exact work:

- :546 `within(stories).queryByText("…")` becomes `within(stories).queryByText("Loading stories…")`.
- One-line edit in the same commit as the TasksPane swap.

Preserved boundary:

- No other existing assertion changes.

Verification: The test still fails if the Stories pane stays in loading.

Dependency: Batch D, with TasksPane. Tests: `self`. Trace: D-8, AC-4.

#### u-tailwind · untouched · `studio/tailwind.config.ts`

Purpose: Every class the components use already exists as a token.

Symbols: `text.secondary`, `text.muted`, `text.primary`, `lifecycle.danger`, `fontSize.xs/sm/base`.

Responsibilities and exact work:

- Supplies `text-text-secondary`, `text-text-muted`, `text-text-primary`, `lifecycle-danger`, `lifecycle-idle`, `lifecycle-attention` and the xs/sm/base sizes.
- No change.

Preserved boundary:

- No token is added by this ticket.

Verification: Tailwind build output contains the classes (studio build).

Dependency: None. Tests: `npm run build --workspace @worktracker/studio`. Trace: D-9.

#### u-toast · untouched · `studio/src/app/shell/ToastHost.tsx`

Purpose: Toasts keep their own alert and status roles and tinted panels.

Symbols: `ToastHost`.

Responsibilities and exact work:

- Toasts are transient notifications, not inline error lines.
- No change.

Preserved boundary:

- Not migrated (E-4).

Verification: overhaulToastNativeOcclusionAcceptance passes unchanged.

Dependency: None. Tests: `src/test/overhaulToastNativeOcclusionAcceptance.test.tsx`. Trace: E-4.

#### u-state-header · untouched · `studio/src/app/shell/ticket-workspace/tasks/components/StateHeaderRow.tsx`

Purpose: Stories tree state headers stay mono and bold; the tree is out of scope.

Symbols: `StateHeaderRow`.

Responsibilities and exact work:

- Keeps its `font-mono ... uppercase` label.
- No change.

Preserved boundary:

- Not migrated (E-1).

Verification: Stories tree suites unchanged.

Dependency: None. Tests: `overhaulStoryReorderAcceptance`. Trace: E-1.


## 11. Coordination with sibling tickets

- 01 (CloseButton): it also edits the headers of `ModalShell`, `StateConfigurationPanel` and `ConversationConfigurationPanel`. This ticket touches only the eyebrow and title elements there.
- 04 (pill and rail): it edits `SettingsModal` rail and `StateConfigurationPanel.tsx:223-241`. No overlap with the title lines.
- 05 (Button) and 06 (TextField): they share `SettingsPrimitives.tsx`, `AddModule`, `AddProject`, `ChildIssues`, `KeyboardShortcutsModal` and `StoryWorkflowGuideDialog`. They touch different elements; whichever lands second rebases.
- 07 and 08 (Menu, Listbox): they change the container of the `DormantWorkspaceTabs` section labels, the WorktreeSwitcher rows and the `MergeDestinationPicker` list. The SectionHeading, EmptyState, LoadingState and ErrorLine elements move with their content unchanged.
- 09 (modals): its `PaneOverlay` must render the overlay eyebrow with `SectionHeading level="eyebrow" as="p"`. `StateCatalog` and `WorkflowImpactDialog` keep the `SectionHeading level="title"` and ErrorLine children when they move onto `ConfirmDialog` or `ModalShell`.
- 11 (StatusDot, Chip): it replaces the inner `findings-queued-count` span passed as `count` with `Chip`, and owns the size of the AutomationFailureChicklet badge. This ticket only recolours it.
- 12 (WorkItemKey, WorkItemListRow): it deletes `Identifier`. This ticket deletes only `GroupHeading`.

## 12. Acceptance mapping

| ID | Criterion (ticket and spec) | Implementation | Verification |
| --- | --- | --- | --- |
| AC-1 | The four components exist in `shared/ui` with tests covering `status` and `alert` roles and heading count rendering. | Batch A; records `section-heading`, `empty-state`, `loading-state`, `error-line`, `placeholder-styles` and the test records | The four new tests plus `SettingsPrimitives.test.tsx` pass. |
| AC-2 | All instances migrated; `SETTINGS_EYEBROW_CLASS`, `SETTINGS_SECTION_HEADING_CLASS` and the private `GroupHeading` deleted. | Batches B and C; records `h-*`, `e-*`, `p-*`, `settings-primitives` | G-1, G-2, G-6; typecheck. |
| AC-3 | No `text-red-400` or hard-coded red in `studio/src` outside tokens. | Batch E; records `r-red-modals`, `h-add-module`, `r-notify`, `r-chicklet` | G-3. |
| AC-4 | Typecheck, studio tests and `test:overhaul` pass. Only the documented assertion changes. | Batch F; record `t-workitem-acceptance` | Section 9 commands. |
| AC-5 | Loading lines announce as status and use `…`. | Batch D; records `l-*` and the loading lines in other records | G-5; LoadingState test; e2e and acceptance strings in section 6. |
| AC-6 | Error lines announce as alert in `lifecycle-danger`; SettingsStatusLine's error tone is ErrorLine. | Batch E; D-5; records `settings-primitives`, `r-*` and the error lines in other records | G-4; ErrorLine and SettingsPrimitives tests; alert assertions in section 6. |
| AC-7 | Existing `data-testid` and `data-*` hooks keep working. | I-1 in every record | The hooks in section 6 resolve in the unchanged suites. |

## 13. Open decisions

None. External dependency: none. Sibling tickets can land in any order relative to this one (section 11).
