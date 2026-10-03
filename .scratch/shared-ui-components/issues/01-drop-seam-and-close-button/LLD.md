# LLD 01 — DropSeam and CloseButton

| Field | Value |
| --- | --- |
| Work item | `01-drop-seam-and-close-button` (local tracker, `.scratch/shared-ui-components/issues/01-drop-seam-and-close-button.md`) |
| Parent | Story "Shared UI component library for Studio" (`.scratch/shared-ui-components/spec.md`) |
| Module | Ticketry Studio frontend, `studio/src` |
| Blocked by | None |
| Blocks | 02 (TabStrip uses both components), 03, 09 (PaneOverlay uses `CloseButton`) |
| Status | Implementation-ready |
| Authority | This `LLD.md` is authoritative. `LLD.html` is a presentation mirror. |

## 1. Behaviour delivered

Every drag-and-drop insertion seam in Studio renders through one `DropSeam` component, and every "×" close or remove affordance renders through one `CloseButton` component. A user sees the same 2 px focus-accent seam when reordering module tabs, workspace tabs, sidebar modules, stories and state sections, and the same close target (hit area, glyph, hover and focus treatment, accessible name) on modals, overlays, tabs and chips.

Spec stories delivered: 5 (identical seam), 22 (same hit area and accessible label), 25 (tokens only), 33 (one import), 35 (behaviour tests), 36–37 (suites green, hooks preserved).

## 2. Scope and invariants

In scope:

- Create `studio/src/shared/ui/DropSeam.tsx` and `studio/src/shared/ui/CloseButton.tsx`, each with a colocated behaviour test.
- Replace the five inline seams and the nine inline "×" buttons listed in the ticket.

Invariants (must not change):

- Drag-and-drop behaviour. `useAxisDragAndDrop`, `axisPlacement`, every `dragSourceProps`/`dropTargetProps` spread and every drop-intent computation stay exactly as they are. Only the seam element is replaced.
- Close behaviour. Every `onClick` handler keeps its current effect, including `WorkspaceTab`'s `event.stopPropagation()` before `onClose`.
- Accessible names. Every close button keeps its current `aria-label` string byte-for-byte (Section 5.3).
- Test hooks. `data-testid` values `module-tab-drop-seam`, `workspace-tab-drop-seam`, `module-drop-seam`, `ticket-drop-seam`, `terminal-panel-tab-close`; attributes `data-drop-intent` and `data-ticket-drop-seam`; the ModuleTab close classes asserted by `overhaulModuleTabCloseAcceptance` (`h-full`, `w-7`, no `hover:bg-pane-bg`, glyph `size-4`, `group-hover/close:bg-pane-bg`, `group-hover/close:text-text-primary`).
- Focus behaviour of `ModalShell` and `SettingsFrame`. Both still find the close button through their `FOCUSABLE` selector because `CloseButton` renders a native, enabled `<button>`.

Out of scope (owned elsewhere):

- `TabStrip`/`Tab` (02), workspace and shell tab strips (03), `PaneOverlay` and `SettingsFrame` rebuild (09), `Button` (05).
- Splitting `SettingsModal.tsx` (460 lines), `StateConfigurationPanel.tsx` (461) and `TasksPane.tsx` (465). This ticket only shrinks the touched regions; 04 and 09 own those regions and their extraction.
- Seam-less drag targets such as `StateCatalog`'s state list (it has no insertion seam today).

## 3. Repository findings (verified 2026-10-02 at `a2541323`)

### 3.1 Seams (all inside a `relative` host)

| # | File:lines | Test id / data | Axis of list | Edge source |
| --- | --- | --- | --- | --- |
| S1 | `app/shell/ticket-workspace/ModuleTab.tsx:63-73` | `module-tab-drop-seam`, `data-drop-intent` | horizontal | `dropIntent` prop |
| S2 | `app/shell/ticket-workspace/selected-ticket/internal/WorkspaceTab.tsx:78-87` | `workspace-tab-drop-seam`, `data-drop-intent` | horizontal | `dropIntent` prop |
| S3 | `app/shell/sidebar/modules/ModuleRow.tsx:51-60` | `module-drop-seam`, `data-drop-intent` | vertical | `dropIntent` prop |
| S4 | `app/shell/ticket-workspace/tasks/TasksPane.tsx:413-422` | `ticket-drop-seam`, `data-ticket-drop-seam` | vertical | `isTarget` and `dragDrop.intent` |
| S5 | `app/shell/ticket-workspace/tasks/components/StateHeaderRow.tsx:77-83` | `ticket-drop-seam` | vertical | `showDropSeam` (always bottom edge) |

All five use `pointer-events-none absolute z-10 bg-focus-accent` with `w-0.5`/`top-0 bottom-0` (horizontal lists) or `h-0.5`/`left-0 right-0` (vertical lists), and `left-0`/`top-0` for `near`, `right-0`/`bottom-0` for `far`.

### 3.2 Close buttons

Panel close (identical class `px-2 py-1 text-lg leading-none text-text-muted hover:bg-pane-title hover:text-text-primary`):

| # | File:lines | `aria-label` | Handler |
| --- | --- | --- | --- |
| C1 | `app/modal/ModalShell.tsx:131-138` | `Close dialog` | `() => (onClose ?? popModal)()` |
| C2 | `features/studio/modals/SettingsModal.tsx:447-454` | `Close dialog` | `onClose` |
| C3 | `features/settings/instant/ConversationConfigurationPanel.tsx:18-25` | `Close Conversation configuration` | `onClose` |
| C4 | `features/workflows/StateConfigurationPanel.tsx:127-134` | `` `Close ${state.name} state configuration` `` | `onClose` |

Chip/tab close (five different class strings today):

| # | File:lines | `aria-label` / extras | Today's look |
| --- | --- | --- | --- |
| C5 | `app/shell/ticket-workspace/ModuleTab.tsx:78-91` | `"Hide " + module.name + " tab"`, `title="Hide tab"` | absolute `h-full w-7`, hidden until group hover/focus, inner `size-4` glyph |
| C6 | `.../selected-ticket/internal/WorkspaceTab.tsx:90-102` | `closeLabel ?? \`Close ${name}\``; handler stops propagation | `opacity-70 hover:opacity-100` |
| C7 | `features/terminal-panel/ShellTabStrip.tsx:61-69` | `` `Close shell ${index + 1}` ``, `data-testid="terminal-panel-tab-close"` | muted text, hover primary |
| C8 | `features/workflows/StageSkillsField.tsx:37-44` | `` `Remove skill "${skill}"` `` | `px-1`, danger hover, `focus:ring` |
| C9 | `features/workflows/StateCatalog.tsx:335-343` | `` `Delete ${state.name}` ``, `disabled={action !== null}` | `size-8`, hidden until row hover/focus, danger hover, hidden when disabled |

The ticket's line numbers point at each element's `className` line; the ranges above are the full elements. No other `×`, `&times;` or `×` glyph exists in `studio/src`.

### 3.3 Existing types and tokens reused

- `DragAxis` (`"vertical" | "horizontal"`) and `DropIntent` (`"near" | "far"`), re-exported from `studio/src/shared/dragDrop/useAxisDragAndDrop.ts` (origin `shared/dragDrop/axisPlacement.ts:12-13`).
- Tailwind tokens from `studio/tailwind.config.ts`: `bg-focus-accent`, `outline-focus-accent`, `text-text-muted`, `text-text-primary`, `bg-pane-bg`, `bg-pane-title`, `text-lifecycle-danger`, `bg-lifecycle-danger/10`. No new token is needed for this ticket.

### 3.4 Guarding tests (grep of `studio/src`)

| Hook | Guarding tests |
| --- | --- |
| `module-tab-drop-seam`, `data-drop-intent` | `src/test/overhaulModuleTabReorderAcceptance.test.tsx` |
| `workspace-tab-drop-seam` | `src/test/overhaulWorkspaceTabOrderAcceptance.test.tsx` |
| `module-drop-seam` | `src/test/overhaulModuleReorderAcceptance.test.tsx`, `overhaulModuleTabReorderAcceptance.test.tsx` |
| `ticket-drop-seam` | Not asserted. Story and state drag behaviour is guarded by `src/test/overhaulStoryReorderAcceptance.test.tsx`. |
| ModuleTab close classes and name | `src/test/overhaulModuleTabCloseAcceptance.test.tsx` (`[overhaul-183]`), `overhaulModulePickerAcceptance.test.tsx`, `overhaulModuleVisibilityAcceptance.test.tsx`, `e2e/web-app.spec.ts` (`Hide … tab`) |
| `Close dialog` | `overhaulSettingsAcceptance`, `overhaulModalOcclusionConvergenceAcceptance`, `overhaulSettingsNativeOcclusionAcceptance`, `overhaulTaskWorkspaceSettingsOcclusionAcceptance`, `overhaulZeroProviderPlanningAcceptance`, `overhaulTaskAgentLaunchInteractionAcceptance`, `overhaulNativeWebViewSiblingAcceptance` |
| `Close Conversation configuration` | `overhaulInstantTicketsAcceptance.test.tsx` |
| State configuration close | `overhaulWorkflowSettingsAcceptance`, `overhaulLaunchConfigurationConvergenceAcceptance`, `overhaulWorkflowStageSkillSerializationAcceptance` |
| Workspace tab close | `overhaulTerminalCloseAcceptance`, `overhaulWorkspaceTabOrderAcceptance`, `overhaulTerminalTabIdentityAcceptance` |
| `terminal-panel-tab-close` | `overhaulTerminalPanelTabsAcceptance.test.tsx` |
| `Remove skill "…"` | `overhaulWorkflowStageSkillsAcceptance`, `overhaulWorkflowStageSkillSerializationAcceptance` |
| `Delete <state>` | `overhaulWorkflowSettingsAcceptance.test.tsx` (`Delete Review`) |

No test asserts class strings on C1–C4 or C6–C9, so their visual unification changes no assertion. C5 keeps every class `[overhaul-183]` asserts (Section 5.2).

### 3.5 Preflight gates

Stop and report instead of improvising if any of these is false at implementation time:

- The five seams and nine close buttons in 3.1–3.2 still exist at, or near, the listed lines with the listed labels and test ids.
- `useAxisDragAndDrop.ts` still re-exports `DragAxis` and `DropIntent`.
- No `studio/src/shared/ui/DropSeam.tsx` or `CloseButton.tsx` exists yet.

## 4. File and component change map

Paths are relative to the repository root.

| ID | Path | Action | Responsibility after change |
| --- | --- | --- | --- |
| F1 | `studio/src/shared/ui/DropSeam.tsx` | Create | The only insertion-seam markup in Studio. |
| F2 | `studio/src/shared/ui/DropSeam.test.tsx` | Create | Behaviour test for F1. |
| F3 | `studio/src/shared/ui/CloseButton.tsx` | Create | The only "×" close or remove control in Studio. |
| F4 | `studio/src/shared/ui/CloseButton.test.tsx` | Create | Behaviour test for F3. |
| F5 | `studio/src/app/shell/sidebar/modules/ModuleRow.tsx` | Modify | S3 → `DropSeam`. |
| F6 | `studio/src/app/shell/ticket-workspace/tasks/TasksPane.tsx` | Modify | S4 → `DropSeam`. |
| F7 | `studio/src/app/shell/ticket-workspace/tasks/components/StateHeaderRow.tsx` | Modify | S5 → `DropSeam`. |
| F8 | `studio/src/app/shell/ticket-workspace/ModuleTab.tsx` | Modify | S1 → `DropSeam`; C5 → `CloseButton`. |
| F9 | `studio/src/app/shell/ticket-workspace/selected-ticket/internal/WorkspaceTab.tsx` | Modify | S2 → `DropSeam`; C6 → `CloseButton`. |
| F10 | `studio/src/app/modal/ModalShell.tsx` | Modify | C1 → `CloseButton`. |
| F11 | `studio/src/features/studio/modals/SettingsModal.tsx` | Modify | C2 → `CloseButton`. |
| F12 | `studio/src/features/settings/instant/ConversationConfigurationPanel.tsx` | Modify | C3 → `CloseButton`. |
| F13 | `studio/src/features/workflows/StateConfigurationPanel.tsx` | Modify | C4 → `CloseButton`. |
| F14 | `studio/src/features/terminal-panel/ShellTabStrip.tsx` | Modify | C7 → `CloseButton`. |
| F15 | `studio/src/features/workflows/StageSkillsField.tsx` | Modify | C8 → `CloseButton`. |
| F16 | `studio/src/features/workflows/StateCatalog.tsx` | Modify | C9 → `CloseButton`. |
| F17 | `studio/src/shared/dragDrop/useAxisDragAndDrop.ts` | Untouched | Supplies `DragAxis`, `DropIntent`, drag props. |
| F18 | Guarding acceptance tests in Section 3.4 | Untouched | Must pass unchanged. |

### F1 `shared/ui/DropSeam.tsx` (create)

- Exports `DropSeam` and `type DropSeamProps`. No default export.
- Imports `type DragAxis` and `type DropIntent` from `../dragDrop/useAxisDragAndDrop`.
- Renders `null` when `edge` is `null`; otherwise one `<span>` with `aria-hidden="true"`, `data-drop-intent={edge}`, the given `data-testid`, and every other `data-*` prop forwarded unchanged.
- Does not compute intent, does not attach drag handlers, does not position its host. The host element must be `position: relative` (all five hosts already are).
- Verification: F2, plus every seam guard in 3.4.

### F2 `shared/ui/DropSeam.test.tsx` (create)

See Section 7.1.

### F3 `shared/ui/CloseButton.tsx` (create)

- Exports `CloseButton`, `type CloseButtonProps`, `type CloseButtonSize`, `type CloseButtonTone`, `type CloseButtonReveal`. No default export.
- Renders `<button type="button">` with `aria-label={label}`, optional `title`, `disabled`, `data-testid`, `onClick`, and one child `<span aria-hidden="true">×</span>` (U+00D7). The span is always the button's first and only element child, because `[overhaul-183]` reads it with `close.querySelector("span")`.
- Does not stop propagation, does not manage focus, and does not decide whether it is shown. Callers own those.
- Verification: F4 and all close guards in 3.4.

### F4 `shared/ui/CloseButton.test.tsx` (create)

See Section 7.1.

### F5 `ModuleRow.tsx` (modify)

- Replace lines 51-60 with `DropSeam` (`axis="vertical"`, `edge={dropIntent}`, `data-testid="module-drop-seam"`).
- Add import `{ DropSeam }` from `../../../../shared/ui/DropSeam`.
- Keep the `li` spread of `dragSourceProps`/`dropTargetProps`, `relative`, and selection classes.
- Verify: `overhaulModuleReorderAcceptance`, `overhaulModuleTabReorderAcceptance`.

### F6 `TasksPane.tsx` (modify)

- Replace lines 413-422 with `DropSeam` (`axis="vertical"`, `edge={isTarget ? dragDrop.intent : null}`, `data-testid="ticket-drop-seam"`, `data-ticket-drop-seam="true"`). React renders the old valueless JSX attribute as `"true"`, so the DOM attribute is unchanged.
- Add import `{ DropSeam }` from `../../../../shared/ui/DropSeam`.
- The `isTarget` expression and `targetProps` spread stay unchanged.
- Visible delta: the seam gains `data-drop-intent`. Nothing reads it here.
- Verify: `overhaulStoryReorderAcceptance`.

### F7 `StateHeaderRow.tsx` (modify)

- Replace lines 77-83 with `DropSeam` (`axis="vertical"`, `edge={showDropSeam ? "far" : null}`, `data-testid="ticket-drop-seam"`).
- Add import `{ DropSeam }` from `../../../../../shared/ui/DropSeam`.
- `showDropSeam` prop name and default stay; `React.memo` wrapper stays.
- Visible delta: gains `data-drop-intent="far"`.
- Verify: `overhaulStoryReorderAcceptance`.

### F8 `ModuleTab.tsx` (modify)

- Replace seam lines 63-73 with `DropSeam` (`axis="horizontal"`, `edge={dropIntent}`, `data-testid="module-tab-drop-seam"`), still the first child of the `role="tab"` button.
- Replace close lines 78-91 with `CloseButton` (`size="chip"`, `reveal="hover"`, `label={"Hide " + module.name + " tab"}`, `title="Hide tab"`, `onClick={() => onHide(module.id)}`, `className="absolute top-0 right-0 h-full w-7"`). The outer `group relative flex w-max shrink-0` wrapper stays because `reveal="hover"` depends on its `group` class.
- Add imports from `../../../shared/ui/DropSeam` and `../../../shared/ui/CloseButton`.
- Keep the props interface, `registerRef`, the `#7aa2f7` selected underline (02 replaces it), `ModuleLifecycleChicklets` and `ModuleJumpBadge` unchanged.
- Visible delta: the close is now revealed on `group-focus-within` and `focus-visible` instead of `focus`.
- Verify: `[overhaul-183]` unchanged, `overhaulModuleTabReorderAcceptance`, `overhaulModulePickerAcceptance`, `overhaulModuleVisibilityAcceptance`.

### F9 `WorkspaceTab.tsx` (modify)

- Replace seam lines 78-87 with `DropSeam` (`axis="horizontal"`, `edge={dropIntent}`, `data-testid="workspace-tab-drop-seam"`).
- Replace close lines 90-102 with `onClose && <CloseButton size="chip" label={closeLabel ?? \`Close ${name}\`} onClick={(event) => { event.stopPropagation(); onClose(event); }} />`. The `MouseEvent<HTMLButtonElement>` argument is assignable to the existing `onClose: (event: MouseEvent<HTMLElement>) => void`.
- Add imports from `../../../../../shared/ui/DropSeam` and `../../../../../shared/ui/CloseButton`.
- Keep the `role="tab"` `div`, `tone`, `highlighted`, `badge` and ref merging. 03 rebuilds this file on `Tab`.
- Visible delta: the "×" loses `opacity-70` and gains the shared chip hover and focus treatment.
- Verify: `overhaulWorkspaceTabOrderAcceptance`, `overhaulTerminalCloseAcceptance`, `overhaulTerminalTabIdentityAcceptance`.

### F10 `ModalShell.tsx` (modify)

- Replace lines 131-138 with `CloseButton` (`size="panel"`, `label="Close dialog"`, `onClick={() => (onClose ?? popModal)()}`).
- Add import `{ CloseButton }` from `../../shared/ui/CloseButton`.
- `FOCUSABLE`, `initialFocusRef` and the focus trap are unchanged.
- Verify: the `Close dialog` suites in 3.4.

### F11 `SettingsModal.tsx` (modify)

- Replace lines 447-454 (inside `SettingsFrame`) with `CloseButton` (`size="panel"`, `label="Close dialog"`, `onClick={onClose}`).
- Add import `{ CloseButton }` from `../../../shared/ui/CloseButton`.
- `SettingsFrame`'s copied focus trap stays. 09 removes it.
- Verify: `overhaulSettingsAcceptance`, `overhaulSettingsNativeOcclusionAcceptance`, `overhaulTaskWorkspaceSettingsOcclusionAcceptance`.

### F12 `ConversationConfigurationPanel.tsx` (modify)

- Replace lines 18-25 with `CloseButton` (`size="panel"`, `label="Close Conversation configuration"`, `onClick={onClose}`).
- Add import `{ CloseButton }` from `../../../shared/ui/CloseButton`.
- Verify: `overhaulInstantTicketsAcceptance`.

### F13 `StateConfigurationPanel.tsx` (modify)

- Replace lines 127-134 with `CloseButton` (`size="panel"`, ``label={`Close ${state.name} state configuration`}``, `onClick={onClose}`).
- Add import `{ CloseButton }` from `../../shared/ui/CloseButton`.
- The pill tablist (04) and header (09) stay unchanged.
- Verify: `overhaulWorkflowSettingsAcceptance`, `overhaulLaunchConfigurationConvergenceAcceptance`.

### F14 `ShellTabStrip.tsx` (modify)

- Replace lines 61-69 with `CloseButton` (`size="chip"`, ``label={`Close shell ${index + 1}`}``, `data-testid="terminal-panel-tab-close"`, `onClick={() => onClose(runId)}`).
- Add import `{ CloseButton }` from `../../shared/ui/CloseButton`.
- The tab wrapper, the `role="tab"` button and the "+" button stay unchanged. 03 moves the strip onto `TabStrip`.
- Verify: `overhaulTerminalPanelTabsAcceptance`.

### F15 `StageSkillsField.tsx` (modify)

- Replace lines 37-44 with `CloseButton` (`size="chip"`, `tone="danger"`, ``label={`Remove skill "${skill}"`}``, `onClick={() => onChange(skills.filter((candidate) => candidate !== skill))}`).
- Add import `{ CloseButton }` from `../../shared/ui/CloseButton`.
- `SETTINGS_FIELD_CLASS` stays. 06 removes it.
- Verify: `overhaulWorkflowStageSkillsAcceptance`, `overhaulWorkflowStageSkillSerializationAcceptance`.

### F16 `StateCatalog.tsx` (modify)

- Replace lines 335-343 with `CloseButton` (`size="chip"`, `tone="danger"`, `reveal="hover"`, ``label={`Delete ${state.name}`}``, `onClick={onRemove}`, `disabled={action !== null}`, `className="size-8"` to keep the row's 32 px grid cell).
- Add import `{ CloseButton }` from `../../shared/ui/CloseButton`.
- The parent `li` keeps its `group` class, which `reveal="hover"` needs. The delete-confirm dialog stays unchanged (09).
- Verify: `overhaulWorkflowSettingsAcceptance` (`Delete Review` opens `Delete Review?`).

## 5. Contracts

### 5.1 `DropSeam` props

| Prop | Type | Required | Default | Behaviour |
| --- | --- | --- | --- | --- |
| `axis` | `DragAxis` (`"horizontal" \| "vertical"`) | yes | — | Axis along which the list is reordered (same value passed to `useAxisDragAndDrop`). `horizontal` draws a vertical line on the left or right edge; `vertical` draws a horizontal line on the top or bottom edge. |
| `edge` | `DropIntent \| null` (`"near" \| "far" \| null`) | yes | — | `null` renders nothing. `near` = left/top, `far` = right/bottom. Also written to `data-drop-intent`. |
| `data-testid` | `string` | yes | — | Caller's stable hook. |
| any `` `data-${string}` `` | `string \| undefined` | no | — | Forwarded verbatim (used for `data-ticket-drop-seam`). |

No `className`, `style` or children. Rendered classes:

| Case | Classes |
| --- | --- |
| Always | `pointer-events-none absolute z-10 bg-focus-accent` |
| `axis="horizontal"` | `top-0 bottom-0 w-0.5`, plus `left-0` (`near`) or `right-0` (`far`) |
| `axis="vertical"` | `right-0 left-0 h-0.5`, plus `top-0` (`near`) or `bottom-0` (`far`) |

ARIA: `aria-hidden="true"` always. The seam is decoration; drop position is not announced today and this ticket adds no announcement.

### 5.2 `CloseButton` props

| Prop | Type | Required | Default | Behaviour |
| --- | --- | --- | --- | --- |
| `label` | `string` | yes | — | `aria-label`. Must name the object being closed, e.g. `Close dialog`, `Hide Alpha tab`. |
| `onClick` | `(event: MouseEvent<HTMLButtonElement>) => void` | yes | — | Called on activation. Does not stop propagation. |
| `size` | `CloseButtonSize` = `"chip" \| "panel"` | yes | — | `chip` for tabs and removable chips; `panel` for modal and overlay headers. |
| `tone` | `CloseButtonTone` = `"neutral" \| "danger"` | no | `"neutral"` | `danger` for destructive removal (skill chips, state delete). |
| `reveal` | `CloseButtonReveal` = `"always" \| "hover"` | no | `"always"` | `hover` hides the button until an ancestor with Tailwind `group` is hovered or contains focus, or the button itself has keyboard focus. When `reveal="hover"` and `disabled`, the button stays hidden. |
| `title` | `string` | no | none | Native tooltip. Not defaulted to `label`. |
| `disabled` | `boolean` | no | `false` | Native `disabled`. |
| `data-testid` | `string` | no | none | Forwarded. |
| `className` | `string` | no | none | Layout only: position, inset, margin, flex/grid placement and box size to fit a host slot (e.g. `absolute top-0 right-0 h-full w-7`, `size-8`). Never colour, typography, border, opacity or interaction states. |

Rendered classes (Tailwind tokens only):

| Part | Case | Classes |
| --- | --- | --- |
| Button | always | `group/close inline-flex shrink-0 items-center justify-center leading-none text-text-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-accent` |
| Button | `chip` | `min-h-5 min-w-5 text-sm` |
| Button | `panel` | `px-2 py-1 text-lg` |
| Button | `panel` + `neutral` | `hover:bg-pane-title hover:text-text-primary` |
| Button | `panel` + `danger` | `hover:bg-lifecycle-danger/10 hover:text-lifecycle-danger` |
| Button | `reveal="always"` | `disabled:cursor-not-allowed disabled:opacity-40` |
| Button | `reveal="hover"` | `opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:!opacity-0` |
| Glyph span | `chip` | `flex size-4 items-center justify-center` |
| Glyph span | `chip` + `neutral` | `group-hover/close:bg-pane-bg group-hover/close:text-text-primary` |
| Glyph span | `chip` + `danger` | `group-hover/close:bg-lifecycle-danger/10 group-hover/close:text-lifecycle-danger` |
| Glyph span | `panel` | none |

A neutral `chip` puts its hover background on the glyph, never on the button. This keeps `[overhaul-183]` true (button has no `hover:bg-pane-bg`; glyph has `size-4`, `group-hover/close:bg-pane-bg`, `group-hover/close:text-text-primary`). Hit area: a `chip` is at least 20×20 px (`min-h-5 min-w-5`) and grows to its host slot through `className`; a `panel` keeps today's padded target.

Keyboard and ARIA: a native `<button type="button">`, so Enter and Space activate it and it never submits a form. The accessible name comes only from `aria-label`; the glyph is `aria-hidden`. Focus is visible through `focus-visible:outline-focus-accent`.

### 5.3 Caller mapping (exact)

| Caller | Component | Props |
| --- | --- | --- |
| S1 ModuleTab | DropSeam | `axis="horizontal"`, `edge={dropIntent}`, `data-testid="module-tab-drop-seam"` |
| S2 WorkspaceTab | DropSeam | `axis="horizontal"`, `edge={dropIntent}`, `data-testid="workspace-tab-drop-seam"` |
| S3 ModuleRow | DropSeam | `axis="vertical"`, `edge={dropIntent}`, `data-testid="module-drop-seam"` |
| S4 TasksPane | DropSeam | `axis="vertical"`, `edge={isTarget ? dragDrop.intent : null}`, `data-testid="ticket-drop-seam"`, `data-ticket-drop-seam="true"` |
| S5 StateHeaderRow | DropSeam | `axis="vertical"`, `edge={showDropSeam ? "far" : null}`, `data-testid="ticket-drop-seam"` |
| C1 ModalShell | CloseButton | `size="panel"`, `label="Close dialog"` |
| C2 SettingsFrame | CloseButton | `size="panel"`, `label="Close dialog"` |
| C3 ConversationConfigurationPanel | CloseButton | `size="panel"`, `label="Close Conversation configuration"` |
| C4 StateConfigurationPanel | CloseButton | `size="panel"`, ``label={`Close ${state.name} state configuration`}`` |
| C5 ModuleTab | CloseButton | `size="chip"`, `reveal="hover"`, `label={"Hide " + module.name + " tab"}`, `title="Hide tab"`, `className="absolute top-0 right-0 h-full w-7"` |
| C6 WorkspaceTab | CloseButton | `size="chip"`, ``label={closeLabel ?? `Close ${name}`}``, handler stops propagation first |
| C7 ShellTabStrip | CloseButton | `size="chip"`, ``label={`Close shell ${index + 1}`}``, `data-testid="terminal-panel-tab-close"` |
| C8 StageSkillsField | CloseButton | `size="chip"`, `tone="danger"`, ``label={`Remove skill "${skill}"`}`` |
| C9 StateCatalog | CloseButton | `size="chip"`, `tone="danger"`, `reveal="hover"`, ``label={`Delete ${state.name}`}``, `disabled={action !== null}`, `className="size-8"` |

## 6. Runtime flows and failure semantics

- Seam: the drag controller resolves `targetId`/`intent` as today; the caller passes the resolved edge (or `null`) to `DropSeam`; the seam appears or disappears on the same render it does today. No new state, effects or listeners. Because the seam is `pointer-events-none`, it never becomes a drag target, which the "omits the drop event" cases in `overhaulModuleTabReorderAcceptance` depend on.
- Close: activation calls the caller's handler synchronously. Errors raised by a handler propagate exactly as before; `CloseButton` adds no try/catch, retries or focus moves. Focus return after a modal closes stays `ModalShell`'s responsibility.
- Disabled close (C9): the native `disabled` attribute blocks activation, so no handler runs. With `reveal="hover"` the control stays invisible, as it does today.

## 7. Verification

### 7.1 New tests (vitest + `@testing-library/react`, `fireEvent`; no class-string assertions)

`studio/src/shared/ui/DropSeam.test.tsx`:

1. `edge={null}` renders nothing (`container` is empty).
2. For each `axis` × `edge`, `getByTestId` finds the seam with `aria-hidden="true"` and `data-drop-intent` equal to the edge.
3. An extra `data-ticket-drop-seam="true"` prop appears on the element.

`studio/src/shared/ui/CloseButton.test.tsx`:

1. `getByRole("button", { name: "Close dialog" })` finds the control (accessible name from `label`); its text content is `×` and the glyph has `aria-hidden="true"`.
2. Clicking calls `onClick` once with the event.
3. `disabled` renders a disabled button, and clicking it does not call `onClick`.
4. Inside a `<form onSubmit={spy}>`, clicking does not submit (`type="button"`).
5. `title` and `data-testid` are forwarded.
6. Each `size`, `tone` and `reveal` combination renders a single accessible button with the given name (a smoke check across the closed union, so a TypeScript-only variant cannot ship broken).

### 7.2 Regression suites (must pass unchanged)

- Every test named in Section 3.4.
- `npm run typecheck` (root).
- `npm run test --workspace @worktracker/studio`.
- `npm run test:overhaul --workspace @worktracker/studio`.

### 7.3 Static check

Run `rg -n '×|pointer-events-none absolute .*bg-focus-accent' studio/src --glob '!**/*.test.*'`. It must report only `studio/src/shared/ui/CloseButton.tsx` and `studio/src/shared/ui/DropSeam.tsx`.

## 8. Ordered implementation plan

| Step | Files | Change | Depends on | Local signal |
| --- | --- | --- | --- | --- |
| 1 | F1, F2 | Add `DropSeam` and its test. | — | `vitest run src/shared/ui/DropSeam.test.tsx` |
| 2 | F3, F4 | Add `CloseButton` and its test. | — | `vitest run src/shared/ui/CloseButton.test.tsx` |
| 3 | F5 | ModuleRow seam. | 1 | `overhaulModuleReorderAcceptance` |
| 4 | F6, F7 | Stories and state seams. | 1 | `overhaulStoryReorderAcceptance` |
| 5 | F8 | ModuleTab seam and close. | 1, 2 | `overhaulModuleTabCloseAcceptance`, `overhaulModuleTabReorderAcceptance`, `overhaulModulePickerAcceptance`, `overhaulModuleVisibilityAcceptance` |
| 6 | F9 | WorkspaceTab seam and close. | 1, 2 | `overhaulWorkspaceTabOrderAcceptance`, `overhaulTerminalCloseAcceptance` |
| 7 | F10–F13 | Panel closes. | 2 | Close-dialog suites, `overhaulInstantTicketsAcceptance`, `overhaulWorkflowSettingsAcceptance` |
| 8 | F14–F16 | Remaining chip closes. | 2 | `overhaulTerminalPanelTabsAcceptance`, stage-skill suites, `overhaulWorkflowSettingsAcceptance` |
| 9 | — | Static check 7.3, typecheck, full studio tests, `test:overhaul`. | 3–8 | All green |

Each step leaves the app working. If a guard fails on a class assertion other than those listed in Section 2, stop: that assertion was not in the inventory and needs a recorded decision, not a silent test edit.

## 9. Acceptance mapping

| Ticket criterion | Steps | Signal |
| --- | --- | --- |
| AC-1 `shared/ui/DropSeam.tsx` and `shared/ui/CloseButton.tsx` exist with behaviour tests | 1, 2 | F2 and F4 pass |
| AC-2 All listed instances use them; no inline seam or "×" markup remains in those files | 3–8 | Static check 7.3 lists only F1 and F3 |
| AC-3 Every `CloseButton` has an `aria-label`; existing test ids are preserved | 2, 5–8 | `label` is a required prop (typecheck); F4 case 1; suites in 3.4 unchanged |
| AC-4 Typecheck, studio tests and `test:overhaul` pass | 9 | Commands in 7.2 |

## 10. Decisions recorded

- D-1 `DropSeam.edge` accepts `null` and renders nothing, so callers drop their ternaries.
- D-2 `DropSeam` forwards extra `data-*` attributes so `data-ticket-drop-seam` survives, even though nothing reads it today.
- D-3 `CloseButton` has a closed `tone` (`neutral`/`danger`) and `reveal` (`always`/`hover`) in addition to the ticket's `size`, because C8/C9 are destructive removals and C5/C9 are hover-revealed today. Dropping either would change visible behaviour.
- D-4 `CloseButton` never stops propagation; the one caller that needs it (C6) does so in its handler.
- D-5 Intended visual deltas: WorkspaceTab and ShellTabStrip "×" adopt the shared chip hover; StageSkillsField's focus ring becomes the shared outline; ModuleTab's close is revealed on `group-focus-within` and `focus-visible`. No test asserts the replaced classes.
