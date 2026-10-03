# LLD — 05 Button and DialogFooter

Status: implementation-ready
Work item: `issues/05-button.md` (local tracker), Story `../../spec.md` (Shared UI component library for Studio)
Repository baseline: `main` at `a2541323`. All paths below are relative to `studio/src/` unless they start with `studio/` or `.scratch/`.
Authority: the Story spec and ticket 05 are authoritative for intent. This LLD fixes every implementation decision for ticket 05. It supersedes nothing. Ticket 09 (modals onto ModalShell) consumes the `Button` and `DialogFooter` contracts fixed here and must not change them.

## 1. Behavior delivered

1. One `Button` component in `shared/ui/Button.tsx` with a closed `variant` union (`primary`, `secondary`, `danger`, `ghost`, `icon`, `dashed`) and a closed `size` union (`xs`, `sm`, `md`).
2. One `DialogFooter` layout component in `shared/ui/DialogFooter.tsx` that always renders Cancel first and the confirm action second, right-aligned.
3. Every button instance listed in ticket 05, plus the unlisted copies inside files this ticket already touches (section 4.3), renders through `Button` or `DialogFooter`.
4. `settingsButtonClass` (with its private `SettingsButtonTier` and `BUTTON_TIER_CLASS`), the three `DialogHost` class constants, and the `OnboardingTour` `buttonClass` constant are deleted.
5. No `bg-accent-primary` button styling remains. (`accent-primary` is not a token in `studio/tailwind.config.ts`, so today the `DialogHost` primary button renders with no fill at all.)

## 2. Scope and invariants

In scope:

- Create `shared/ui/Button.tsx`, `shared/ui/Button.test.tsx`, `shared/ui/DialogFooter.tsx` and `shared/ui/DialogFooter.test.tsx`.
- Migrate the 36 instance files and 2 helper files in the change map (section 5) and delete the superseded helpers.

Invariants (must not change):

- Accessible names, roles, `disabled`, `aria-*`, `title`, event handlers, refs and focus targets of every migrated button.
- Every existing `data-testid` and `data-*` hook on a migrated element (list in section 6.4).
- DOM order of buttons, except where `DialogFooter` already matches today's order (all seven ticket footers are already Cancel then confirm, so no footer reorders).
- `studio/tailwind.config.ts` and `app/styles/*.css` are untouched. Every class used below is an existing token or a built-in Tailwind 3.4 utility or variant (`size-*`, `enabled:`, `aria-busy:`, `aria-expanded:`).
- The existing test suites stay green with no assertion edits (section 8.3 names the one class assertion that constrains `ghost`).

Out of scope (owned elsewhere or deferred):

- Text inputs and selects, including `DialogHost.tsx:85` `focus:border-accent-primary` on the reassign select: ticket 06.
- "×" close buttons (`StateCatalog.tsx:340`, `ModalShell.tsx:135`, tab closes): ticket 01 `CloseButton`.
- Tab-look selectors and pressed toggles (`IssueTypesSection.tsx:85-104`, `StateConfigurationPanel.tsx:223-241`, `SettingsModal.tsx:350-383`, `FooterChangesToggle.tsx:50-58`, `ChangesToolbar.tsx:176-179`): ticket 04.
- Scrim, focus trap and Escape for `StateCatalog` and `WorkflowImpactDialog` dialogs: ticket 09. This ticket only swaps their footer markup.
- "▾" suffix spans (`DormantWorkspaceTabs.tsx:167`) and menu bodies: tickets 07 and 08. The suffix stays as a child of the `Button`.
- Error lines using `text-red-400` in the migrated modals: ticket 10.
- The `<a>` "Open PR" link in `ChangesToolbar.tsx:165-172`: `Button` renders only `<button>`; links stay links.
- Unlisted dense worktree buttons, deferred to a follow-up ticket (section 4.4).

## 3. Repository findings

- `shared/ui/SettingsPrimitives.tsx:15-37` defines `SettingsButtonTier` (`primary`, `secondary`, `danger`, `danger-filled`), `BUTTON_TIER_CLASS` and `settingsButtonClass(tier, className)`. 8 caller files, 25 call sites (section 5). The rest of the file (`SETTINGS_FIELD_CLASS`, `SETTINGS_EYEBROW_CLASS`, `SETTINGS_CHECKBOX_CLASS`, `SettingsStatusLine`, `SettingsSubsection`) stays for tickets 06 and 10.
- `app/shell/DialogHost.tsx:5-8` defines `buttonClass`, `primaryButtonClass` (`bg-accent-primary text-white`) and `dangerButtonClass`. Used by `ConfirmDialog` (:30-45) and `ReassignDialog` (:96-112).
- `app/onboarding/OnboardingTour.tsx:15-16` defines a fourth system, `buttonClass` (`bg-focus-accent ... text-pane-bg`), used at :93, :112, :172. Not listed by the ticket; same file as a listed instance, so it is in scope.
- Every ticket line number was verified against `a2541323`; none has drifted.
- `studio/tailwind.config.ts` tokens used: `pane-bg`, `pane-panel`, `pane-border`, `pane-title`, `focus-accent`, `text-primary`, `text-secondary`, `text-muted`, `lifecycle-danger`. Tailwind is `^3.4.17`, so `size-7`, `enabled:hover:`, `aria-busy:`, `aria-expanded:` are available. There is no `clsx`, `tailwind-merge` or `class-variance-authority`; classes are joined with a template string.
- The Studio footer (`app/shell/StudioFooter.tsx`) is `h-6` and `text-xs`. The ticket's `sm` size (the `h-7` action buttons) cannot fit there, and the dashed triggers are all `py-0.5 text-xs`. This is why `xs` exists (decision D-2).
- Test runner: vitest `include: ["src/**/*.test.{ts,tsx}"]`, jsdom, setup `src/test/setup.ts` (jest-dom matchers, RTL cleanup). `@testing-library/user-event` is not installed; tests use `fireEvent`. Colocated prior art: `shared/dragDrop/useAxisDragAndDrop.test.tsx`, `features/work-items/WorkItemSearchList.test.tsx`.
- `app/__tests__/moduleBoundaries.test.ts` forbids `shared/` from importing `app/` or `features/`. `Button` and `DialogFooter` import only `react` and each other. `shared/ui` is not a product root, so every feature may import it directly.
- `ModalShell` takes `initialFocusRef`; `DialogHost` passes its `cancelRef`, so `DialogFooter` must forward a ref to the Cancel button.

## 4. Decisions

### 4.1 Fixed decisions

- **D-1 One file per component.** `Button` in `shared/ui/Button.tsx`, `DialogFooter` in `shared/ui/DialogFooter.tsx`. No barrel. No exported class-string helper, so nobody can copy classes onto a non-`Button` element.
- **D-2 Sizes are `xs`, `sm`, `md`.** The spec lists `sm` and `md`. `xs` is added because the 24px footer bar and the four `text-xs` dashed triggers cannot use `h-7` without clipping or growing. This changes the spec's list, so it is reported to the caller as well.
- **D-3 One look per variant.** `settingsButtonClass` `danger` (outline) and `danger-filled` both become `danger`, which uses the tinted `DialogHost` look. `settingsButtonClass` `primary` (filled accent) and the `OnboardingTour` filled accent become `primary`, which uses the accent border the spec specifies. The run actions (`RunNowAction`, `NormalRunAction` Run) and the inverted `ChangesToolbar` primary also become `primary`.
- **D-4 Hover only when enabled.** Every hover token uses `enabled:hover:`, so disabled buttons stop changing on hover. This replaces the per-site `disabled:hover:*` resets.
- **D-5 Pending state through `aria-busy`.** Base classes include `disabled:aria-busy:cursor-wait`. Callers that set `aria-busy` (run buttons, merge) keep the wait cursor; other disabled buttons show `not-allowed`.
- **D-6 Open state through `aria-expanded`.** The `dashed` variant draws a solid accent border when `aria-expanded="true"`. This replaces the `DormantWorkspaceTabs` open/closed ternary without an extra prop.
- **D-7 `className` is layout only.** Allowed: margin, `w-full`, `shrink-0`, `flex-none`, `whitespace-nowrap`, `text-left`, grid/flex placement. Forbidden: colour, border, background, padding, height, font-size, font-weight and gap. Reviewers enforce this; there is no runtime check.
- **D-8 `icon` requires `aria-label`.** It is enforced in the type: the `icon` member of the props union declares `aria-label: string` as required.
- **D-9 `DialogFooter` is props-driven, not slot-driven,** so order, variants, sizes and `type="button"` cannot drift. Cancel is always `secondary md`. Confirm is `primary` or `danger` at `md`.
- **D-10 Dialogs with a single action** (`NotifyUserModal` acknowledgement, `StoryWorkflowGuideDialog` Close) keep their wrapper and use a single `Button`. `DialogFooter` always has a Cancel.
- **D-11 Inline forms are not dialogs.** The inline Add/Cancel pairs in `IssueTypesSection.tsx:446-467` and `StateCatalog.tsx:223-241`, the Settings Discard/Save bars, and the `ChangesToolbar` confirmation popover keep their current order and use plain `Button`s.
- **D-12 `KeyboardSettingsPanel` binding cell** drops `font-mono` (mono is already the global default face) and drops the recording-time `bg-pane-title`/`bg-pane-bg` swap, because a background is a restyle that `className` must not carry. The recording state is still shown by the visible label "Press a chord…" and the existing accessible name. `aria-pressed` is not added.
- **D-13 `PickerTrigger` keeps its public `variant` prop** (`default | dashed | bare | crumb`), so its four callers stay untouched. Internally `default` maps to `Button secondary sm`, `dashed` to `Button dashed xs` and `bare` to `Button ghost sm`. `crumb` is an underlined text-link look, not a button variant, so it keeps its local `<button>` and class string.
- **D-14 `ghost` uses `border-transparent`, never `border-pane-border`.** `test/overhaulWorkItemAcceptance.test.tsx:190` asserts that the bare issue-type trigger does not carry both `border` and `border-pane-border`.

### 4.2 Intentional visual changes (accepted by the spec's "look the same everywhere" goal)

Settings primary buttons change from filled accent to accent border. Destructive buttons become one tinted danger style. Modal Cancel buttons lose `bg-pane-bg`. Run actions use accent text. The `ChangesToolbar` primary changes from inverted white to accent border. The dashed `PickerTrigger` changes from accent dashed to muted dashed with an accent hover. `StateCatalog` ↑/↓ become borderless `icon` buttons. Onboarding filled buttons become accent border. Footer buttons gain a 1px transparent border and use `px-2`. All buttons gain a `focus-visible` accent ring. Screen behaviour does not change.

### 4.3 Unlisted copies included (same files as listed instances, or same signature)

- `app/onboarding/OnboardingTour.tsx:63-71` (skip tour), `:90-97`, `:109-116`, `:170-177` (`buttonClass`).
- `app/onboarding/OnboardingProviders.tsx:253-260` (filled accent Continue).
- `app/shell/ticket-workspace/selected-ticket/details/StoryWorkflowGuideAction.tsx:3-16` (an `h-7` action beside the run buttons).
- `features/agents/worktrees/changes/ChangesToolbar.tsx:143-159` (confirmation Confirm and Cancel).

### 4.4 Deferred copies (follow-up ticket, not acceptance for 05)

These are dense `text-xs` worktree pane buttons (`border border-pane-border px-2 py-1` or `py-0.5`) plus two placeholders. They are not in ticket 05's inventory, and their size needs a visual review at `xs` against `sm`. They must not be migrated piecemeal in this ticket.

- `features/agents/worktrees/changes/WorktreeMergePreview.tsx:223-347` (8 buttons).
- `features/agents/worktrees/changes/BranchInspector.tsx:134-204` (6).
- `features/agents/worktrees/changes/WorktreeLifecycle.tsx:151`.
- `features/agents/worktrees/WorktreeBlock.tsx:284,296,317,386`.
- `app/shell/ticket-workspace/EmptyModuleWorkspace.tsx:22` and `app/shell/ticket-workspace/tasks/components/StoriesSearchEmptyState.tsx:25` (placeholders, ticket 10 neighbourhood).
- Prototype-only `features/conversations/prototype/ConversationListVariant.tsx:226` and `ConversationInboxVariant.tsx:399`.

## 5. File and component change map

Action key: C create, M modify, U intentionally untouched.

### 5.1 New shared components

| File | Action | Responsibility after change | Not responsible for |
| --- | --- | --- | --- |
| `shared/ui/Button.tsx` | C | `Button` (`forwardRef<HTMLButtonElement>`), types `ButtonVariant`, `ButtonSize`, `ButtonProps`; private `BASE_CLASS`, `SIZE_CLASS`, `ICON_SIZE_CLASS`, `VARIANT_CLASS` maps. | Links, menus, toggles with tab look, close "×" buttons. |
| `shared/ui/Button.test.tsx` | C | Behaviour tests (section 8.1). | Class-string assertions. |
| `shared/ui/DialogFooter.tsx` | C | `DialogFooter`, `DialogFooterProps`. Composes `Button`. | Scrim, focus trap, Escape (`ModalShell`). |
| `shared/ui/DialogFooter.test.tsx` | C | Behaviour tests (section 8.2). | — |

### 5.2 Helpers deleted (contract)

| File | Action | Work |
| --- | --- | --- |
| `shared/ui/SettingsPrimitives.tsx` | M | Delete `SettingsButtonTier`, `BUTTON_TIER_CLASS`, `settingsButtonClass` (lines 15-37) after batch C. Leave every other export byte-identical. |
| `app/shell/DialogHost.tsx` | M | Delete `buttonClass`, `primaryButtonClass`, `dangerButtonClass` (5-8). `ConfirmDialog` footer becomes `DialogFooter` with `cancelRef={cancelRef}`, `onCancel={() => resolve(false)}`, `onConfirm={() => resolve(true)}`, `confirmLabel={opts.confirmLabel ?? "Confirm"}`, `confirmVariant={opts.danger ? "danger" : "primary"}`, `className="mt-5"`. `ReassignDialog` footer becomes `DialogFooter` with `cancelRef`, `onCancel={() => resolve(null)}`, `onConfirm` unchanged, `confirmLabel` = "Reassign" or "Continue", `confirmDisabled={hasCandidates && !selectedId}`, `className="mt-5"`. The select at :81-92 is untouched (ticket 06). |

### 5.3 Instance migrations

Mapping column format: variant / size / extra layout `className`. "DF" means `DialogFooter`.

| File (line at a2541323) | Action | Mapping |
| --- | --- | --- |
| `features/studio/modals/AddProject.tsx:78-94` | M | DF: `onCancel={popModal}`, `onConfirm={() => void submit()}`, `confirmLabel="Create"`, `confirmDisabled={!canSubmit}`, `className="mt-3"`. |
| `features/studio/modals/AddModule.tsx:228-244` | M | DF: `onCancel={popModal}`, `onConfirm={() => void submit()}`, `confirmLabel` = "Save folder" or "Create module" (existing ternary), `confirmDisabled={!canSubmit}`, `className="mt-3"`. |
| `features/agents/terminal/ModuleFolder.tsx:124-140` | M | DF: `onCancel={popModal}`, `onConfirm={() => void save()}`, `confirmLabel="Save"`, `confirmDisabled={busy \|\| !selection.isValid}`, `className="mt-3"`. |
| `features/agents/terminal/PromptInput.tsx:82-99` | M | DF: `onCancel={popModal}`, `cancelDisabled={busy}`, `onConfirm={() => void submit()}`, `confirmLabel` = existing expression, `confirmDisabled` = existing expression, `className="mt-3"`. |
| `app/modal/NotifyUserModal.tsx:46-53` | M | `primary md` with `ref={acknowledgementRef}`; wrapper `div` kept. |
| `app/modal/ModalErrorBoundary.tsx:79-94` | M | DF: `onCancel={this.handleClose}`, `cancelLabel="Close"`, `onConfirm={this.handleRetry}`, `confirmLabel="Retry"`, `className="mt-4"`. The scrim is untouched (ticket 09 decides). |
| `features/workflows/StoryWorkflowGuideDialog.tsx:154` | M | `secondary md` "Close"; wrapper with `border-t` kept. |
| `features/workflows/WorkflowImpactDialog.tsx:59-69` | M | DF: `onCancel={close}`, `onConfirm={() => void confirm()}`, `confirmLabel={change.confirmLabel}`, `confirmVariant="danger"`. Drop the `settingsButtonClass` import. Dialog wrapper untouched (ticket 09). |
| `features/workflows/StateCatalog.tsx` | M | :138-144 Refresh impact: `danger md`, `mt-2`. :165-193 footer: DF with `cancelAutoFocus`, `onCancel` = existing inline reset function, `onConfirm={impact && !hardBlocked ? () => void confirmRemoval() : undefined}`, `confirmLabel` = "Deleting…" or "Delete state", `confirmVariant="danger"`, `confirmDisabled={action !== null \|\| impactConflict !== null}`, `className="mt-5"`. :225-231 Create state: `primary md`. :233-239 Cancel: `secondary md`. :244-250 Add state: `dashed md`, `mt-3 w-full text-left`. :317-332 ↑/↓: `icon md` (keep `aria-label`). :334-341 × untouched (ticket 01). Drop import. |
| `features/workflows/TransitionDisclosure.tsx:90-102` | M | `danger md`. Drop import. |
| `features/workflows/IssueTypesSection.tsx` | M | :301-309 Launch configuration: `secondary md` (keep `aria-expanded`). :311-319 Remove state: `danger md`. :420-428 + Add destination: `dashed md`. :446-458 Add: `primary md`. :459-465 Cancel: `secondary md`. :85-104 untouched (ticket 04). Drop import. |
| `features/studio/modals/KeyboardSettingsPanel.tsx` | M | :184-191 Restore defaults: `secondary md`, `shrink-0`. :238-259 binding cell: `secondary md`, `text-left` (D-12). :264-272 Reset: `secondary md`. Drop import. |
| `features/studio/modals/SettingsModal.tsx:210-230` | M | Discard: `secondary md`. Save changes: `primary md`. `SettingsFrame`, the rail and the close button are untouched (tickets 01, 04, 09). Drop import. |
| `features/settings/instant/InstantSettingsPanel.tsx:142-161` | M | Discard: `secondary md`. Save (keeps `aria-label="Save conversation settings"`): `primary md`. Drop import. |
| `features/app-updates/AppUpdatesSection.tsx:94-114` | M | Update and restart / Retry update: `primary md`. Check for updates: `secondary md`. Drop import. |
| `app/startup/BootstrapGate.tsx:83-89` | M | Retry: `primary md`. |
| `app/startup/SettingsAccess.tsx:25-35` | M | `secondary md` (keep `aria-label`, `onPointerEnter`, `onFocus`, icon child). |
| `app/onboarding/OnboardingTour.tsx` | M | Delete `buttonClass` (:15-16). :63-71 Skip tour: `ghost md`. :90-97 Next, :109-116 Got it, :170-177 Finish tour: `primary md`. :158-169 Story workflow guide: `secondary md`. All `data-testid`s kept. |
| `app/onboarding/OnboardingProviders.tsx:253-260` | M | Continue: `primary md`. |
| `features/terminal-panel/ModuleFolderRequired.tsx:81-89` | M | Use this folder: `primary md`, `mt-3`. Keep `data-testid="terminal-panel-link-folder"`. |
| `features/terminal-panel/DeadShell.tsx:32-40` | M | Restart shell: `secondary md`. |
| `features/terminal-panel/TerminalPanel.tsx:126-133` | M | Try again: `secondary md`. |
| `features/agents/terminal/XtermTerminal.tsx:123-130` | M | View here: `secondary md`. |
| `features/agents/terminal/NativeGhosttyTerminal.tsx:299-305` | M | View here: `secondary md`. |
| `app/shell/ticket-workspace/selected-ticket/details/RunNowAction.tsx:34-45` | M | `primary sm`, `flex-none`. `KeyBadge` child kept. |
| `app/shell/ticket-workspace/selected-ticket/details/NormalRunAction.tsx` | M | :103-114 Open: `secondary sm`. :194-206 Run: `primary sm`, `flex-none`; `IconPlay` and `KeyBadge` children kept. |
| `app/shell/ticket-workspace/selected-ticket/details/internal/SubtreeRunButton.tsx:26-38` | M | `secondary sm`. Props interface unchanged. |
| `app/shell/ticket-workspace/selected-ticket/details/StoryWorkflowGuideAction.tsx:3-16` | M | `secondary sm`, `flex-none whitespace-nowrap`. Keep `data-story-workflow-guide-toolbar` and the `currentTarget.focus()` handler. |
| `app/shell/ticket-workspace/selected-ticket/details/fields/PickerTrigger.tsx` | M | D-13. `PickerTriggerProps` unchanged. |
| `app/shell/ticket-workspace/selected-ticket/internal/WorkspaceLauncher.tsx:241-290` | M | `dashed xs`, `shrink-0`, `ref={launchTriggerRef}`; every handler and aria prop kept; the `disabled:hover:*` resets are dropped (D-4). The menu body is untouched. |
| `app/shell/ticket-workspace/selected-ticket/internal/DormantWorkspaceTabs.tsx:147-168` | M | `dashed xs`, `ref={triggerRef}`; the open ternary is removed (D-6). The count `span` and "▾" `span` children are kept as is. |
| `features/agents/worktrees/changes/ChangesToolbar.tsx` | M | :106-118 primary: `primary sm`, `ref={primaryRef}`. :143-150 Confirm: `primary sm`. :151-159 Cancel: `secondary sm`, `ref={cancelRef}`. Order kept (D-11). Open PR link and Branch toggle untouched. |
| `app/shell/StudioFooterActions.tsx:21-34` | M | `ghost xs` (keep `aria-label`, `aria-describedby`, preload handlers, children). |
| `features/terminal-panel/FooterTerminalToggle.tsx:36-48` | M | `ghost xs` (keep `data-testid`, `aria-label`, `title`, `disabled`). |
| `features/conversations/prototype/ConversationInboxVariant.tsx:316-322` | M | `primary md`, `shrink-0` (trivial swap). |
| `features/conversations/prototype/ConversationTimelineVariant.tsx:138-144` | M | `primary md`, `shrink-0` (trivial swap). |

### 5.4 Boundary files (untouched)

`studio/tailwind.config.ts`, `app/styles/tailwind.css`, `app/modal/ModalShell.tsx`, `shared/ui/KeyChordHint.tsx`, `app/shell/dialogStore.ts`, all `src/test/*` files.

## 6. Contracts

### 6.1 `Button` props

`ButtonProps` extends `ButtonHTMLAttributes<HTMLButtonElement>` with `className` narrowed to layout use. It is a union on `variant`.

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `variant` | `"primary" \| "secondary" \| "danger" \| "ghost" \| "icon" \| "dashed"` | `"secondary"` | Closed set (`ButtonVariant`). |
| `size` | `"xs" \| "sm" \| "md"` | `"md"` | Closed set (`ButtonSize`). |
| `type` | `"button" \| "submit" \| "reset"` | `"button"` | Always written to the DOM. |
| `aria-label` | `string` | — | Required when `variant` is `"icon"` (type-level). Optional otherwise. |
| `className` | `string` | `""` | Layout only (D-7). Appended last. |
| `ref` | `Ref<HTMLButtonElement>` | — | Forwarded with `forwardRef`; `displayName` is `"Button"`. |
| `children` | `ReactNode` | — | Icons, labels, `KeyBadge`, count spans. |
| other | native button attributes | — | `disabled`, `onClick`, `onKeyDown`, `onPointerEnter`, `onFocus`, `autoFocus`, `title`, `aria-*`, `data-*` pass through untouched. |

Rendered element: a single `<button>` whose class is base, then size, then variant, then `className`, joined with spaces.

### 6.2 Exact Tailwind tokens

Base (every variant): `inline-flex items-center border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:aria-busy:cursor-wait`

Size, for every variant except `icon`:

| Size | Classes | Replaces |
| --- | --- | --- |
| `xs` | `gap-1 px-2 py-0.5 text-xs` | footer bar, dashed chip triggers |
| `sm` | `h-7 gap-2 px-2.5 text-sm` | the h-7 detail action buttons, picker triggers, Changes toolbar |
| `md` | `gap-2 px-3 py-1.5 text-sm` | modal, settings, placeholder and gate buttons |

Size, for `icon`:

| Size | Classes |
| --- | --- |
| `xs` | `size-5 justify-center text-xs` |
| `sm` | `size-7 justify-center text-sm` |
| `md` | `size-8 justify-center text-sm` |

Variant:

| Variant | Classes | Absorbs |
| --- | --- | --- |
| `primary` | `border-focus-accent bg-pane-title font-semibold text-focus-accent enabled:hover:bg-pane-bg` | `settingsButtonClass("primary")`, `DialogHost` `primaryButtonClass`, `OnboardingTour` `buttonClass`, accent-outline modal and gate buttons, run actions, `ChangesToolbar` primary and Confirm, prototype New chat |
| `secondary` | `border-pane-border text-text-primary enabled:hover:border-text-secondary enabled:hover:bg-pane-title` | `settingsButtonClass("secondary")`, `DialogHost` `buttonClass`, modal Cancel, secondary-with-hover list, `SubtreeRunButton`, Open subtree run, `PickerTrigger` default |
| `danger` | `border-lifecycle-danger/60 bg-lifecycle-danger/15 text-lifecycle-danger enabled:hover:bg-lifecycle-danger/25` | `settingsButtonClass("danger")`, `settingsButtonClass("danger-filled")`, `DialogHost` `dangerButtonClass` |
| `ghost` | `border-transparent text-text-muted enabled:hover:bg-pane-bg enabled:hover:text-text-primary` | footer bar buttons, onboarding Skip tour, `PickerTrigger` bare |
| `icon` | `border-transparent text-text-muted enabled:hover:bg-pane-title enabled:hover:text-text-primary` | `StateCatalog` ↑/↓ |
| `dashed` | `border-dashed border-pane-border text-text-muted enabled:hover:border-focus-accent enabled:hover:text-text-primary aria-expanded:border-solid aria-expanded:border-focus-accent aria-expanded:text-text-primary` | `WorkspaceLauncher` ＋ Agent, `DormantWorkspaceTabs` trigger, `PickerTrigger` dashed, Add state, + Add destination |

Every class string is a literal in `Button.tsx`, so Tailwind's content scan (`./src/**/*.{ts,tsx}`) finds it.

### 6.3 `DialogFooter` props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `onCancel` | `() => void` | required | Cancel is always rendered first, as `Button secondary md type="button"`. |
| `cancelLabel` | `ReactNode` | `"Cancel"` | `ModalErrorBoundary` passes "Close". |
| `cancelDisabled` | `boolean` | `false` | `PromptInput` while busy. |
| `cancelRef` | `Ref<HTMLButtonElement>` | — | For `ModalShell initialFocusRef` (`DialogHost`, ticket 09). |
| `cancelAutoFocus` | `boolean` | `false` | `StateCatalog` until ticket 09 moves it to `ModalShell`; ticket 09 may stop using it but keeps the prop. |
| `onConfirm` | `() => void` | — | When omitted, the confirm button is not rendered. |
| `confirmLabel` | `ReactNode` | `"Confirm"` | Busy text such as "Deleting…" is passed by the caller. |
| `confirmVariant` | `"primary" \| "danger"` | `"primary"` | Size is always `md`. |
| `confirmDisabled` | `boolean` | `false` | — |
| `className` | `string` | `""` | Layout only, usually the top margin (`mt-3`, `mt-4`, `mt-5`). |

Rendered: `<div class="flex justify-end gap-2 {className}">`, then Cancel, then the optional confirm. No `role`, no `data-*`. `DialogFooter` takes no children. A dialog that needs a third action adds it outside the footer, and ticket 09 must not add a children slot.

### 6.4 Hooks preserved

The following stay on the same elements: `data-testid` `onboarding-skip-tour`, `onboarding-module-name-next`, `onboarding-module-folder-done`, `onboarding-story-workflow-guide`, `onboarding-finish`, `terminal-panel-link-folder`, `terminal-panel-restart-shell`, `terminal-panel-retry`, `terminal-reclaim`, `dormant-tabs-trigger`, `footer-terminal-toggle`. Also `PickerTrigger`'s pass-through `data-testid` and `data-story-workflow-guide-toolbar`. `aria-busy` stays on Run now, Run item and `SubtreeRunButton`; `aria-expanded` and `aria-haspopup` stay on the launcher, the dormant trigger and Launch configuration.

## 7. Runtime flows and failure semantics

- Click: `Button` adds no handler. Native `disabled` blocks clicks, as before. Pending buttons keep `disabled` plus `aria-busy`, and the base classes show the wait cursor.
- Focus: refs reach the same `<button>` nodes, so `ModalShell` initial focus (`DialogHost`, `NotifyUserModal`), `ChangesToolbar` focus restore and `WorkspaceLauncher` and `DormantWorkspaceTabs` trigger focus return behave as they do today. `StateCatalog` Cancel autofocus is kept through `cancelAutoFocus`.
- Forms: no migrated button sits in a `<form>` today. `type` defaults to `button`, so the onboarding buttons at `OnboardingTour.tsx:90,170` that had no `type` cannot submit by accident.
- Failure: no new failure modes. A missing `aria-label` on an `icon` fails `npm run typecheck`. A leftover `settingsButtonClass` import fails typecheck once the export is deleted.

## 8. Verification

### 8.1 `shared/ui/Button.test.tsx` (vitest + RTL, `fireEvent`)

1. It renders a `button` role named by its children, with `type="button"` by default.
2. An explicit `type="submit"` inside a `<form>` triggers the form's `onSubmit`. The default type inside a form does not.
3. When `disabled`, `toBeDisabled()` passes and a click does not call `onClick`.
4. A forwarded ref equals the element returned by `getByRole("button")`.
5. `aria-expanded`, `aria-busy`, `title` and `data-testid` pass through to the element.
6. Every variant and size combination is reachable: iterate over all 6 variants and 3 sizes (`icon` with an `aria-label`), find each by role and name, click it, and check that its handler ran. This is the "variant danger reachable" check.
7. `icon` takes its accessible name from `aria-label`. A `@ts-expect-error` line rendering `icon` without `aria-label` keeps the type rule from regressing.

No test asserts class names.

### 8.2 `shared/ui/DialogFooter.test.tsx`

1. With both actions, `getAllByRole("button")` names are `["Cancel", confirmLabel]` in that order.
2. The default labels are "Cancel" and "Confirm".
3. `onCancel` and `onConfirm` fire once per click.
4. `confirmDisabled` disables confirm and suppresses `onConfirm`. `cancelDisabled` disables Cancel.
5. Without `onConfirm`, only Cancel renders.
6. `cancelRef.current` is the Cancel element, and `cancelAutoFocus` gives Cancel focus on mount.
7. `confirmVariant="danger"` confirm is reachable by name and fires `onConfirm`.

### 8.3 Existing suites guarding each batch (must stay green unchanged)

| Batch | Guarding tests (`src/test/` unless noted) |
| --- | --- |
| B dialogs | `overhaulDialogAcceptance`, `overhaulDialogHostNativeOcclusionAcceptance`, `overhaulDirectoryTrustAcceptance`, `overhaulModuleSelectionAcceptance`, `overhaulWorktreeCreationRuntimeAcceptance`, `overhaulTaskWorkspaceIdentifierAcceptance`, `overhaulTaskAgentLaunchAcceptance`, `overhaulWorkspaceStoreIsolationAcceptance`, `dialogStore.test.ts`, `overhaulModuleCreationAcceptance`, `overhaulOnboardingModuleAcceptance`, `overhaulModuleFolderAcceptance`, `overhaulModalLoadFailureAcceptance`, `overhaulChangesWorkspaceRecoveryAcceptance`, `overhaulStoryWorkflowGuideAcceptance` |
| C settings | `overhaulSettingsAcceptance`, `overhaulKeybindingSettingsRuntimeAcceptance`, `overhaulInstantSettingsAcceptance`, `overhaulAppUpdatesAcceptance`, `overhaulWorkflowSettingsAcceptance`, `LaunchConfigurationForm.test.tsx`, `overhaulZeroProviderPlanningAcceptance` |
| D gates, onboarding, terminal | `overhaulGateAcceptance`, `overhaulWebSettingsReachabilityAcceptance`, `desktopStartupFailure.test.tsx`, `OnboardingGate.test.tsx`, `CoachMark.test.tsx`, `overhaulOnboardingCompletionAcceptance`, `overhaulOnboardingModuleAcceptance`, `overhaulProjectOnboardingAcceptance`, `overhaulTerminalPanelExitAcceptance`, `overhaulTerminalPanelAcceptance`, `overhaulNativeViewerOwnershipAcceptance` |
| E detail actions and triggers | `overhaulRunNowAcceptance`, `overhaulAgentRunVisibilityAcceptance`, `overhaulSubtreeRunAcceptance`, `overhaulRustLaunchPolicyAcceptance`, `overhaulSelectedTaskWorktreeAcceptance`, `overhaulWorkItemAcceptance` (its `:190` class assertion constrains `ghost`, D-14), `overhaulDormantWorkspaceTabsAcceptance`, `overhaulTaskAgentLaunchInteractionAcceptance`, `overhaulTaskAgentLaunchNavigationAcceptance`, `overhaulScratchAcceptance`, `overhaulInstantTicketsAcceptance`, `overhaulChangesActionsAcceptance`, `overhaulChangesZoneArrowAcceptance`, `overhaulTaskWorktreeChangesAcceptance` |
| F footer, prototypes | `overhaulTerminalPanelFurnitureAcceptance`, `overhaulTerminalPanelModuleScopeAcceptance`, `overhaulModuleVersionControlAcceptance`, `overhaulModalOcclusionConvergenceAcceptance`, `overhaulSettingsNativeOcclusionAcceptance`, `overhaulConversationDesignPrototypeAcceptance` |
| All | `app/__tests__/moduleBoundaries.test.ts` (shared stays independent) |

No direct test exercises `AddProject`, `PromptInput` or `TerminalPanel` retry. `DialogFooter.test.tsx` and typecheck cover them. No existing assertion is edited by this ticket.

### 8.4 Final gates (repository root)

- `npm run typecheck`
- `npm run test --workspace @worktracker/studio`
- `npm run test:overhaul --workspace @worktracker/studio`
- `npm run build --workspace @worktracker/studio`
- `grep -rn "settingsButtonClass\|BUTTON_TIER_CLASS\|primaryButtonClass\|dangerButtonClass" studio/src` returns nothing.
- `grep -rn "bg-accent-primary" studio/src` returns nothing. (`focus:border-accent-primary` on the `DialogHost` select remains until ticket 06.)
- `grep -n "const buttonClass" studio/src/app/onboarding/OnboardingTour.tsx studio/src/app/shell/DialogHost.tsx` returns nothing.
- Manual: in `npm run web`, open AddModule, a `DialogHost` confirm, Settings → Workflows (delete a state), the footer bar and the details toolbar. Check that the footer bar fits its 24px height and that focus rings show on Tab.

## 9. Ordered implementation plan

1. **Batch A: components.** Create `Button.tsx`, `DialogFooter.tsx` and both tests per section 6. Gate: `npx vitest run src/shared/ui/Button.test.tsx src/shared/ui/DialogFooter.test.tsx` and typecheck. Nothing else changes.
2. **Batch B: non-settings dialogs.** `DialogHost` (delete the 3 constants), `AddProject`, `AddModule`, `ModuleFolder`, `PromptInput`, `ModalErrorBoundary`, `NotifyUserModal`, `StoryWorkflowGuideDialog`. Gate: the batch B tests in section 8.3.
3. **Batch C: settings callers, then the helper deletion.** `WorkflowImpactDialog`, `StateCatalog`, `TransitionDisclosure`, `IssueTypesSection`, `KeyboardSettingsPanel`, `SettingsModal`, `InstantSettingsPanel`, `AppUpdatesSection`. Then delete `settingsButtonClass`, `BUTTON_TIER_CLASS` and `SettingsButtonTier` from `SettingsPrimitives.tsx`. Gate: batch C tests plus the first grep.
4. **Batch D: gates, onboarding, terminal placeholders.** `BootstrapGate`, `SettingsAccess`, `OnboardingTour` (delete `buttonClass`), `OnboardingProviders`, `ModuleFolderRequired`, `DeadShell`, `TerminalPanel`, `XtermTerminal`, `NativeGhosttyTerminal`. Gate: batch D tests.
5. **Batch E: detail actions and triggers.** `RunNowAction`, `NormalRunAction`, `SubtreeRunButton`, `StoryWorkflowGuideAction`, `PickerTrigger`, `WorkspaceLauncher`, `DormantWorkspaceTabs`, `ChangesToolbar`. Gate: batch E tests.
6. **Batch F: footer bar and prototypes.** `StudioFooterActions`, `FooterTerminalToggle`, `ConversationInboxVariant`, `ConversationTimelineVariant`. Gate: batch F tests.
7. **Final.** Section 8.4 gates.

Each batch is one commit and leaves the tree green. Batches B to F depend only on A and may land in any order, except that the helper deletion at the end of C must follow every `settingsButtonClass` caller.

Merge-conflict note: tickets 01, 04, 06 and 09 edit other lines in `StateCatalog`, `IssueTypesSection`, `SettingsModal`, `DialogHost`, `WorkflowImpactDialog` and `ChangesToolbar`. Rebase onto whichever lands first and keep both edits; there is no semantic overlap.

## 10. Acceptance mapping

| ID | Ticket criterion | Steps | Signal |
| --- | --- | --- | --- |
| AC-1 | `shared/ui/Button.tsx` and `DialogFooter` exist with tests (disabled, type defaults to `button`, variant `danger` reachable) | 1 | Section 8.1 tests 1, 3, 6 and section 8.2 test 7 pass |
| AC-2 | All instances migrated; `settingsButtonClass` and the `DialogHost` class constants are deleted | 2 to 6 | Section 5.3 complete; grep in 8.4 is empty; typecheck passes |
| AC-3 | No `bg-accent-primary` button styling remains | 2 | `grep -rn "bg-accent-primary" studio/src` is empty |
| AC-4 | Typecheck, studio tests and `test:overhaul` pass | 7 | Section 8.4 commands exit 0, with no edits to existing assertions |
| AC-5 | Footer bar buttons use `ghost` (ticket text) | 6 | `StudioFooterActions` and `FooterTerminalToggle` render `Button variant="ghost" size="xs"`; the furniture tests pass |
| AC-6 | Dialog footers put Cancel before confirm (spec story 12) | 2, 3 | Section 8.2 test 1; the 7 ticket footers plus `StateCatalog` and `ModalErrorBoundary` use `DialogFooter` |
| AC-7 | `data-testid` and `data-*` hooks preserved (spec story 37) | 2 to 6 | Section 6.4 list; the existing suites pass unchanged |

## 11. Open items for the caller

- D-2 adds a third size, `xs`, to the spec's `sm` and `md`. It is needed for the 24px footer and the `text-xs` dashed triggers. If it is rejected, the footer bar must grow or keep bespoke classes. Both conflict with the spec, so this LLD treats `xs` as decided.
- Section 4.4 lists about 20 deferred dense worktree buttons that need a follow-up ticket for "every inline copy" to hold repository-wide.
