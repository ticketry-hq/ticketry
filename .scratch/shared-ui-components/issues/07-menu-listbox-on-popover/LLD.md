# LLD 07: Menu and Listbox on Popover, with a shared arrow-key hook

Status: implementation-ready
Work item: `.scratch/shared-ui-components/issues/07-menu-listbox-on-popover.md`
Parent story: `.scratch/shared-ui-components/spec.md` (Shared UI component library for Studio)
Module: Ticketry Studio frontend, `studio/src`
Blocks: ticket 08 (`08-search-pickers-on-listbox/LLD.md` consumes the `Listbox` contract fixed here)
Supersedes: nothing

## 1. Design basis

Authoritative inputs, in order: the repository `CLAUDE.md` (layout and naming rules, one concern per file, `shared/ui` for cross-feature plumbing), the parent story's "Menu and Listbox" and "Testing Decisions" sections, the ticket, and the current code and tests listed in section 3.

This LLD delivers:

- `Popover` gains flip-when-no-room, viewport clamping, an anchor-to-tablist option, an optional portal, controlled open state, focus return on Escape, opt-in dismissal on focus-out, an optional panel role, and a single panel surface style. `Popover` already closes on Escape; that behavior is kept and given focus return.
- `PopoverOption` becomes the single option row (one size, one active style), used by menu items, listbox options and the existing field pickers.
- A new hook, `useListNavigation`, owns Up/Down, Home/End, Enter and Space for every list.
- New `Menu` (`role="menu"` / `menuitem`) and `Listbox` (`role="listbox"` / `option`, `aria-activedescendant` when a search field owns focus) are built on `Popover`.
- The three action menus `IssueActionsMenu`, `DormantWorkspaceTabs` and `WorkspaceLauncher` move onto `Menu`. Their own dismissal, positioning and arrow-key code is deleted.

Ticket 08 moves the three search pickers onto `Listbox`. Ticket 07 ships `Listbox` with tests but gives it no production caller.

## 2. Scope and invariants

### In scope

- `shared/ui/Popover.tsx`: extend `Popover` and `PopoverOption`.
- New `shared/ui/useListNavigation.ts`, `shared/ui/Menu.tsx`, `shared/ui/Listbox.tsx`, and colocated tests.
- Migrate `IssueActionsMenu.tsx`, `DormantWorkspaceTabs.tsx` and `WorkspaceLauncher.tsx` onto `Menu`.

### Invariants (must not change)

- Every accessible name, role and `data-testid` listed in section 6.7 stays the same.
- The existing `Popover` callers keep compiling and working without edits: `WorkflowStatePicker.tsx`, `fields/StatePicker.tsx`, `fields/IssueTypePicker.tsx`, `fields/ParentPicker.tsx`, `fields/BlockerPicker.tsx`, `features/agents/worktrees/WorktreeBlock.tsx`, and `features/work-items/WorkItemSearchList.tsx` (which uses `PopoverOption`, `PopoverSearch` and `PopoverContent` directly). The `trigger` render-prop fields `open`, `onClick` and `disabled` and the `children(close)` signature are unchanged.
- The `IssueActionsMenu` panel stays in the details DOM subtree, not in a portal. `overhaulTaskWorkspaceIdentifierAcceptance` queries `within(details).getByTestId("delete-issue")`.
- The `DormantWorkspaceTabs` and `WorkspaceLauncher` panels stay portalled to `document.body`, because they are anchored to the workspace tab strip.
- `[role="menu"][aria-label="Launch agent"]` is still an ancestor of the launcher's menu items. `useGlobalKeymap.isLaunchMenuTarget` depends on it.
- The element with `role="menu"` named "Dormant tabs" keeps the classes `max-h-[60vh]` and `overflow-y-auto`. `overhaulDormantWorkspaceTabsAcceptance` asserts them.
- Dormant resume rows keep the menu open while a resume runs (`DormantWorkspaceTabs.tsx:29-31`).
- The launcher's task-kind trigger still opens the agent-picker modal. It never opens the menu.
- Native terminal views keep yielding to open menus. `useNativeWebViewSiblingInteraction` finds overlays by `[role="menu"]`, `[role="listbox"]` and `[data-native-terminal-overlay]`, and counts only the outermost match.

### Out of scope

- The search pickers `ModulePicker`, `WorktreeSwitcher` and `MergeDestinationPicker` (ticket 08).
- Moving `WorkItemSearchList` and the field pickers onto `Listbox`. They keep their current markup and gain only the `Popover` improvements. This is follow-up work, recorded in section 11.
- The private `Dot` copies in `fields/StatePicker.tsx:21` and `WorkflowStatePicker.tsx:36`, and the duplicate "No permitted transitions" rows (`StatePicker.tsx:62`, `WorkflowStatePicker.tsx:84`). Tickets 10 and 11 own them. This ticket adds no new copy.
- `Button` (05), `TextField` (06), `SectionHeading`/`EmptyState` (10) and `StatusDot` (11). Triggers keep their own markup. Section 11 lists optional swaps for later.
- Typeahead (first-letter jump) inside `Menu`. In this ticket, "type-to-filter" means the `Listbox` search field.

## 3. Repository findings

### 3.1 Popover today (`studio/src/shared/ui/Popover.tsx`, 109 lines)

- `Popover({ trigger, children, align, disabled, "data-testid" })`. Internal `open` state. The wrapper is `<div className="relative" ref={ref}>`. The panel is `position: fixed`, rendered inside the wrapper (no portal).
- Position (lines 37-58): `top = trigger.bottom + 4`; `left = trigger.left` (align left) or `right = innerWidth - trigger.right` (align right). It tracks window `resize` and capture-phase passive `scroll`. There is no flip and no clamp.
- Dismissal (lines 60-75): a document `mousedown` outside the wrapper closes it. Document `keydown` Escape closes it. Focus is not returned to the trigger.
- Panel class: `fixed z-50 w-max min-w-[200px] max-w-[380px] overflow-hidden border border-pane-border bg-pane-panel py-1 shadow-2xl`.
- `PopoverOption({ selected, onClick, children })` (lines 89-109): a `<button>` with `flex w-full items-center gap-2 px-3 py-1.5 text-left text-base hover:bg-pane-title`, plus `text-focus-accent` when selected, otherwise `text-text-primary`.
- `PopoverContent.tsx` (13 lines): `max-h-[320px] overflow-y-auto` wrapper. `PopoverSearch.tsx` (16 lines): an `autoFocus` text input inside a `border-b p-1.5` wrapper. Its props are `Omit<InputHTMLAttributes, "className">`, so callers can set `role`, `type` and `aria-*`.

### 3.2 Current Popover callers (verified)

| Caller | Uses | Notes |
| --- | --- | --- |
| `app/shell/ticket-workspace/selected-ticket/details/WorkflowStatePicker.tsx:69-131` | `Popover`, `PopoverOption`, `PopoverContent` | `data-testid="state-picker"`; caret at :75 |
| `.../details/fields/StatePicker.tsx:48-86` | `Popover`, `PopoverOption` | `data-testid="state-picker"` |
| `.../details/fields/IssueTypePicker.tsx:34-69` | `Popover`, `PopoverOption`, `PopoverContent` | `data-testid="issue-type-picker"`, `disabled={saving}` |
| `.../details/fields/ParentPicker.tsx:60-87` | `Popover` + `WorkItemSearchList` | `align="right"`, `data-testid="parent-picker"` |
| `.../details/fields/BlockerPicker.tsx:35-57` | `Popover` + `WorkItemSearchList` | `align="right"`, `data-testid="blocker-picker"` |
| `features/agents/worktrees/WorktreeBlock.tsx:338-374` | `Popover` | `align="right"`; "⋯" trigger named "Show/Hide worktree details"; body `data-testid="worktree-details"` holds text and Discard buttons |
| `features/work-items/WorkItemSearchList.tsx:61-95` | `PopoverOption`, `PopoverSearch`, `PopoverContent` | rendered inside Parent/Blocker popovers |

None of these callers attaches a ref to its trigger. `PickerTrigger` and `GhostChipAdd` do not forward refs.

### 3.3 Ticket instances (verified; lines drifted slightly)

| File | Ticket lines | Verified | Hand-rolled code to delete |
| --- | --- | --- | --- |
| `app/shell/ticket-workspace/selected-ticket/details/IssueActionsMenu.tsx` | 26-44, 71-73, 94, 105 | 22-44 (state, refs, mousedown + Escape effect), 60-111 (wrapper, trigger, `absolute right-0 top-full` panel `shadow-lg`, two `menuitem` buttons) | the effect, `open` state, `containerRef`, `triggerRef`, and the panel markup |
| `features/agents/worktrees/WorktreeBlock.tsx` | 344-354 | 338-374 | none; see D-7 |
| `app/shell/ticket-workspace/selected-ticket/internal/DormantWorkspaceTabs.tsx` | 33-35, 69-112 | 33-36 (item and section classes), 55-58 (state, refs), 69-71 (close-when-empty), 73-90 (focus first + pointerdown), 92-115 (fixed position below `[role="tablist"]`), 119-139 (Escape + Up/Down wrap), 170-243 (portal panel) | all listed ranges |
| `app/shell/ticket-workspace/selected-ticket/internal/WorkspaceLauncher.tsx` | 110-175, 309 | 71-72 (menu ref, position), 108-128 (focus first + pointerdown), 130-180 (ResizeObserver + flip + tablist anchor), 203-238 (Escape, Enter/Space, Up/Down wrap, Home/End), 291-314 (portal panel, `data-launcher-item`) | all listed ranges |

### 3.4 Couplings found in the code

- `features/agents/terminal/internal/useNativeWebViewSiblingInteraction.ts:7-13`: the overlay selector. Nested matches are filtered out, so only the outermost match counts (lines 52-58).
- `app/navigation/useGlobalKeymap.ts:35-38, 80`: a capture-phase keymap skips events whose target is inside `[role="menu"][aria-label="Launch agent"]`.
- `internal/WorkspaceTabStrip.tsx:121-283`: the launcher renders inside `role="tablist"` (the inner `workspace-tab-scroll` is `overflow-x-auto`). `DormantWorkspaceTabs` is the `trailing` child of the same tablist. `SelectedTicketContent.tsx:107` owns `launcherTriggerRef`, and `useTaskWorkspaceTabNavigation.ts:166-175` reads it.
- `features/agents/worktrees/changes/ChangesToolbar.tsx:75, 85`: toolbar arrow roving ignores targets inside `[role="dialog"]` or `[role="listbox"]` and controls with `[aria-expanded="true"]`. This matters for ticket 08. The `Listbox` and `Popover` contracts here keep both attributes intact.

### 3.5 Guarding tests (must stay green unchanged)

| Test | Pins |
| --- | --- |
| `src/test/overhaulTaskWorkspaceIdentifierAcceptance.test.tsx:186-187` | `issue-actions-trigger` click, then `within(details).getByTestId("delete-issue")`, so the panel is not portalled |
| `src/test/overhaulNativeWebViewSiblingAcceptance.test.tsx:261-273` | `button "Issue actions"`, `menu "Issue actions"`, exactly one overlay frame while open, `delete-issue` click closes |
| `src/test/overhaulSubtreeRunAcceptance.test.tsx:265` | trigger `button "Issue actions"` order in the status row |
| `src/test/overhaulDormantWorkspaceTabsAcceptance.test.tsx:26-31` | no menu before click; `menu "Dormant tabs"` has `max-h-[60vh]` and `overflow-y-auto`; 18 `menuitem` rows named `Reopen …` |
| `src/test/dormantTabsFixture.ts` (used by dormant and resume suites) | `dormant-tabs-trigger` with `aria-expanded`; `getByRole("menuitem", { name })` |
| `src/test/overhaulTaskAgentLaunchAcceptance.test.tsx:146-151` | scratch kind: `menuitem "Plan"` and `menuitem "Instant"` visible; no agent dialog |
| `src/test/overhaulScratchAcceptance.test.tsx:79` | click `menuitem "Plan"` starts the scratch flow |
| `src/test/overhaulTaskAgentLaunchInteractionAcceptance.test.tsx:40`, `overhaulEditViewNavigationAcceptance.test.tsx:538` | task kind: no `menu "Launch agent"` |
| `src/test/worktree/WorktreeBlock.test.tsx:115-161`, `overhaulWorktreeDiscardRuntimeAcceptance`, `overhaulSelectedTaskWorktreeAcceptance`, `overhaulWorktreeStatusRuntimeAcceptance`, `overhaulWorktreeCreationRuntimeAcceptance`, `overhaulWorktreeRefreshRuntimeAcceptance` | WorktreeBlock "Show worktree details" button, `worktree-details`, `button "Discard"` |
| `overhaulTransitionLandingAcceptance`, `overhaulRunNowAcceptance`, `overhaulSelectedTaskWorktreeAcceptance`, `overhaulWorkItemAcceptance`, `overhaulReparentConvergenceAcceptance` | field pickers by `state-picker`, `issue-type-picker` and `parent-picker`; options are found by role `button` |
| `src/features/work-items/WorkItemSearchList.test.tsx` | placeholder search, click selects, `close` called |
| `src/test/overhaulModulePickerAcceptance.test.tsx:344-345, 384` | uses `pointerDown` for outside dismissal. Its picker moves in ticket 08, but it confirms that `pointerdown` is the established dismissal event |

No test fires `mouseDown` outside a `Popover` to dismiss it (checked across `src/test`, `src/features`, `src/app`). Switching `Popover` to `pointerdown` is therefore safe.

## 4. Preflight gates

- G-1: `npm run typecheck`, `npm run test --workspace @worktracker/studio` and `npm run test:overhaul --workspace @worktracker/studio` are green on the starting commit. If not, stop and report. Do not fix unrelated failures in this ticket.
- G-2: The callers in 3.2 and the instances in 3.3 still match. If a new `Popover` caller has appeared, it must still compile against the extended props. If a new hand-rolled menu has appeared, list it and leave it alone.
- G-3: If any guarding test in 3.5 would need an edit to pass, stop. This ticket changes no existing assertion.

## 5. File and component change map

| # | Path (under `studio/src/`) | Action | Responsibility after change |
| --- | --- | --- | --- |
| F-1 | `shared/ui/Popover.tsx` | modify | Anchoring, flip, clamp, portal, open state (controlled or not), dismissal, focus return, the panel surface; `PopoverOption` as the single row |
| F-2 | `shared/ui/useListNavigation.ts` | create | Active-item state and Up/Down/Home/End/Enter/Space key handling for any list |
| F-3 | `shared/ui/Menu.tsx` | create | `role="menu"` action list on `Popover`; real DOM focus moves between items |
| F-4 | `shared/ui/Listbox.tsx` | create | `role="listbox"` picker on `Popover`; three focus modes (section 6.5) |
| F-5 | `shared/ui/Popover.test.tsx` | create | Positioning (flip, tablist anchor, clamp), dismissal, focus return, controlled mode |
| F-6 | `shared/ui/Menu.test.tsx` | create | Menu roles and keyboard behavior, Escape, outside click, focus return |
| F-7 | `shared/ui/Listbox.test.tsx` | create | Listbox roles and keyboard behavior in all three modes; this is the test for the hook |
| F-8 | `app/shell/ticket-workspace/selected-ticket/details/IssueActionsMenu.tsx` | modify | Builds the issue's action items; renders the "⋯" trigger |
| F-9 | `app/shell/ticket-workspace/selected-ticket/internal/DormantWorkspaceTabs.tsx` | modify | Builds dormant entries (resume, reopen, terminated) as `Menu` items and headings |
| F-10 | `app/shell/ticket-workspace/selected-ticket/internal/WorkspaceLauncher.tsx` | modify | Launch intent (task opens the modal, scratch opens the mode menu); identity guard; scratch items through `Menu` |
| U-1 | `shared/ui/PopoverContent.tsx` | untouched | Still used by the field pickers and `WorkItemSearchList` |
| U-2 | `shared/ui/PopoverSearch.tsx` | untouched | `Listbox` reuses it by spreading combobox props; ticket 06 may restyle it |
| U-3 | `features/agents/worktrees/WorktreeBlock.tsx` | untouched | Details disclosure stays a plain `Popover` (D-7) |
| U-4 | field pickers in 3.2 and `features/work-items/WorkItemSearchList.tsx` | untouched | Inherit the `Popover` changes only |
| U-5 | `features/agents/terminal/internal/useNativeWebViewSiblingInteraction.ts`, `app/navigation/useGlobalKeymap.ts` | untouched | Their selectors keep matching (section 6.6) |

### F-1 `shared/ui/Popover.tsx` (modify)

- Why: the ticket requires flip and a single surface, and the three menus each copied anchoring and dismissal code.
- Work:
  - Add the props and trigger fields in 6.1.
  - Replace the `mousedown` listener with `pointerdown`, checked against both the wrapper and the panel.
  - Add the panel `onKeyDown` handler for Escape.
  - Measure the panel and apply flip and clamp (6.2).
  - Add `ResizeObserver` tracking.
  - Use `createPortal` when `portal` is set.
  - Add the `onBlur` focus-out check when `dismissOnFocusOut` is set.
  - Add `data-native-terminal-overlay` to the panel.
  - Extend `PopoverOption` to the contract in 6.3.
- Not responsible for: roles inside the panel (Menu and Listbox own them), key navigation, or item markup.
- Expected size is about 200 lines. If it passes 300, move positioning into a private `shared/ui/popoverPosition.ts` (a pure function from rects to a style).
- Verify with F-5 and the guarding tests for the untouched callers.

### F-2 `shared/ui/useListNavigation.ts` (create)

- Contract in 6.4. Pure state plus a key handler. It has no DOM access and does not move focus. Menu and Listbox move focus.
- Verified through F-7, and through F-6 for menus.

### F-3 `shared/ui/Menu.tsx` (create)

- Contract in 6.5.1. It composes `Popover`, `useListNavigation` and `PopoverOption`. It owns the menu id, the first-item focus on open, the focus that follows the active item, close-on-select, and headings.
- Not responsible for: item domain logic, or the trigger's look.

### F-4 `shared/ui/Listbox.tsx` (create)

- Contract in 6.5.2. It composes `Popover`, `useListNavigation`, `PopoverOption` and `PopoverSearch`. It owns option ids, `aria-activedescendant`, the `aria-selected` rule, the active reset on open and on query change, the fallback when the active option disappears, and the header, footer and empty slots.
- Not responsible for: filtering, which callers do, or any domain value.

### F-5 to F-7 tests (create)

The lists are in section 9.1. vitest with `@testing-library/react`, colocated next to the component. This matches the existing `src/features/work-items/WorkItemSearchList.test.tsx` pattern.

### F-8 `IssueActionsMenu.tsx` (modify)

- Delete `useEffect`, `useRef` and `useState`, the `containerRef` and `triggerRef`, the dismissal effect (22-44), and the panel (76-110).
- Render `Menu` with `label="Issue actions"` and `align="right"`. Leave `portal` unset.
- Items:
  - `open-terminal`: label "Open terminal"; `disabled={moduleId === null}`; title "Select a module first" or "Open a shell in this issue's worktree"; `testId="open-issue-terminal"`; `onSelect=chooseTerminal`.
  - `delete`: label "Delete issue…"; `disabled={hasSubtasks}`; title "Remove sub-tasks first" or "Delete this issue"; `tone="danger"`; `testId="delete-issue"`; `onSelect=chooseDelete`.
- `chooseTerminal` and `chooseDelete` no longer call `setOpen`, because the menu closes itself.
- The trigger keeps `aria-label="Issue actions"`, `title`, `data-testid="issue-actions-trigger"`, "⋯" and its class. It spreads `ariaProps` and attaches `triggerRef`, `onClick` and `onKeyDown`. Remove the hard-coded `aria-controls="issue-actions-menu"` and `aria-haspopup` attributes; `ariaProps` supplies them.
- Verify with the guarding tests for `issue-actions-trigger`, `delete-issue` and "Issue actions" in 3.5.

### F-9 `DormantWorkspaceTabs.tsx` (modify)

- Delete `useEffect`, `useLayoutEffect`, `useRef`, `useState`, `createPortal`, `CSSProperties` and `KeyboardEvent` imports. Delete `itemClassName` and `sectionClassName`, the state and refs (55-58), the effects at 69-115, `onMenuKeyDown` and the portal panel.
- Keep the derivation of `resumable`, `count`, `empty` and `resumingCount`. Keep `if (empty) return null;`. Unmounting the `Menu` closes it, which replaces the effect at 69-71.
- Render `Menu` with `label="Dormant tabs"`, `align="right"`, `anchor="tablist"`, `portal`, and `className="ml-1 flex shrink-0 items-center"`.
- Items, in order:
  - If resumable rows exist: heading `{ kind: "heading", id: "resume", label: "Resume conversation" }`, then one item per resumable row:
    - `id`: `resume:${chip.key}`
    - `ariaLabel`: `Resume ${chip.accessibleName}`
    - `title`: `chip.hoverTitle || undefined`
    - `disabled`: `resumingRunIds.has(chip.key)`
    - `keepOpen`: true
    - `onSelect`: `() => onResumeTerminal(session)`
    - `label`: `<span className={providerTextClass(chip)}>{resuming ? "Resuming…" : "↻ " + chip.label}</span>`
  - If closed documents exist: heading "Reopen document", then items:
    - `id`: `doc:${document.id}`
    - `ariaLabel`: `Reopen ${document.label}`
    - `label`: `+ ${document.label}`
    - `onSelect`: `() => onReopenDocument(document.id)`
  - If history rows exist: heading "Terminated", then items:
    - `id`: `history:${chip.key}`
    - `ariaLabel`: `Terminated ${chip.accessibleName}`
    - `title`: `chip.hoverTitle || "Terminated run"`
    - `disabled`: true
    - `onSelect`: a no-op
    - `label`: `<span className={providerTextClass(chip)}>{chip.label} ✕</span>`
- Trigger: keep `aria-label` `Dormant tabs (${count})`, `title`, `data-testid="dormant-tabs-trigger"`, the class switch on `open`, the label and count spans, and the "▴"/"▾" caret on `open`. Spread `ariaProps` and attach `triggerRef`, `onClick` and `onKeyDown`.
- Keep the header comment (20-31), updated to say the menu is `Menu`.
- Verify with `overhaulDormantWorkspaceTabsAcceptance` and the dormant fixture users.

### F-10 `WorkspaceLauncher.tsx` (modify)

- Delete `useLayoutEffect`, `CSSProperties` and `createPortal`. Delete `launchMenuRef` and `launchMenuPosition`, the effects at 108-128 and 130-180, `onLauncherMenuKeyDown`, the portal panel, and `data-launcher-item`.
- Keep `launchOpen` state and the identity effect (100-106), `launchCommittedRef`, `openLauncherRef`, `currentLauncherIdentityRef`, `warmLaunchIntent`, `activateLauncherItem` and `prefetchProviderCatalog`.
- Render a controlled `Menu`:
  - `label="Launch agent"`, `anchor="tablist"`, `portal`, `className="shrink-0"`, `triggerRef={triggerRef}`, `open={launchOpen}`.
  - `onOpenChange={(next) => { if (!next) openLauncherRef.current = null; setLaunchOpen(next); }}`
  - `items` from `SCRATCH_LAUNCH_MODES`, each `{ kind: "item", id, label, onSelect: () => activateLauncherItem(id) }`.
- The trigger's `onClick` keeps its current body: task kind calls `pushModal`, scratch kind toggles `launchOpen` with the identity bookkeeping. The trigger does not spread `onClick` or `onKeyDown` from the trigger props. It does spread `ariaProps` for scratch, and keeps `aria-haspopup="dialog"` with no `aria-expanded` for task kind. Its `ref` stays the `triggerRef` prop.
- The menu is mounted only when `launchOpen` is true. Task kind never sets `launchOpen`, so `menu "Launch agent"` is never present for task kind.
- Verify with the launcher tests in 3.5.

## 6. Contracts

### 6.1 `Popover` (default export of `shared/ui/Popover.tsx`)

Props:

| Prop | Type | Default | Meaning |
| --- | --- | --- | --- |
| `trigger` | `(props: PopoverTriggerProps) => ReactNode` | required | Renders the trigger |
| `children` | `(close: () => void) => ReactNode` | required | Panel body. `close()` closes without moving focus |
| `align` | `"left" \| "right"` | `"left"` | Panel's left edge at the trigger's left edge, or right edge at the trigger's right edge |
| `anchor` | `"trigger" \| "tablist"` | `"trigger"` | `"tablist"` places the panel below the lower of the trigger's bottom and the nearest ancestor `[role="tablist"]` bottom |
| `portal` | `boolean` | `false` | Render the panel into `document.body` |
| `disabled` | `boolean` | `false` | Passed to the trigger. Becoming true while open closes the panel |
| `open` | `boolean` | uncontrolled | When defined, open state is controlled |
| `onOpenChange` | `(open: boolean) => void` | none | Called on every open-state change request, in both modes |
| `triggerRef` | `RefObject<HTMLElement>` | internal ref | Element that receives focus on Escape and is excluded from outside dismissal |
| `dismissOnFocusOut` | `boolean` | `false` | Close when focus moves to a non-null target outside the wrapper and panel |
| `panelRole` | `"dialog" \| "region"` | none | Role on the panel element |
| `panelLabel` | `string` | none | `aria-label` on the panel; required when `panelRole` is set |
| `className` | `string` | none | Wrapper layout classes only (margins, flex placement), appended to `relative` |
| `data-testid` | `string` | none | On the wrapper (unchanged) |

`PopoverTriggerProps` (exported type):

| Field | Type | Meaning |
| --- | --- | --- |
| `open` | `boolean` | Current state (unchanged) |
| `disabled` | `boolean \| undefined` | Pass-through (unchanged) |
| `onClick` | `() => void` | Toggles open (unchanged) |
| `onKeyDown` | `(event: KeyboardEvent<HTMLElement>) => void` | Enter or Space with no modifier: toggles open, `preventDefault`, `stopPropagation`. Other keys are ignored |
| `triggerRef` | `(element: HTMLElement \| null) => void` | Callback ref that registers the trigger when no `triggerRef` prop was given |
| `panelId` | `string` | `useId`-based id of the panel element, for `aria-controls` |

Behavior:

- Trigger element: the `triggerRef` prop's element if given, else the element registered through the `triggerRef` callback. Otherwise it falls back to the first `button` or `input` inside the wrapper, which covers the untouched callers whose trigger components do not forward refs.
- Escape:
  - From a keydown inside the panel: `preventDefault`, `stopPropagation`, then focus the trigger with `{ preventScroll: true }`, close, and focus the trigger again in `requestAnimationFrame`. The double focus keeps the `ModulePicker` precedent: edit-view focus effects can otherwise win the same commit.
  - From the document `keydown` listener while open (focus not in the panel): close and focus the trigger, without stopping propagation. This keeps the current field-picker behavior.
- Outside dismissal: document `pointerdown` whose target is outside both the wrapper and the panel closes without moving focus.
- Focus-out (`dismissOnFocusOut`): React `onBlur` on the wrapper (portal events bubble through React). If `relatedTarget` is non-null and outside both the wrapper and the panel, close without moving focus. A null `relatedTarget` (window blur) never closes.
- Select or `close()`: closes without moving focus. Callers that need focus back call it themselves.
- Panel element:
  - Class: `fixed z-50 w-max min-w-[200px] max-w-[380px] overflow-hidden border border-pane-border bg-pane-panel py-1 shadow-2xl`. This is the single floating surface. The menus' `shadow-lg`, `min-w-[150px]`, `min-w-[240px]` and `min-w-[10ch]` variants are dropped.
  - Attributes: `id={panelId}`, `data-native-terminal-overlay=""`, and `role` and `aria-label` from `panelRole` and `panelLabel`.

### 6.2 Positioning (in `Popover`)

All values are in CSS pixels. `GAP = 4`, `MARGIN = 8`. The panel is measured with `getBoundingClientRect()` on every update.

1. `t` = trigger rect. `anchorBottom` is `t.bottom`, or for `anchor="tablist"`, `max(t.bottom, closest('[role="tablist"]').getBoundingClientRect().bottom)`. If no tablist is found, `t.bottom` is used.
2. `below = anchorBottom + GAP`. `fitsBelow = below + panel.height <= innerHeight - MARGIN`.
3. `top`:
   - If `fitsBelow`, use `below`.
   - Otherwise flip if `t.top - GAP - MARGIN > innerHeight - MARGIN - below`; the flipped value is `max(MARGIN, t.top - GAP - panel.height)`.
   - If neither condition holds, use `below`.
4. `left`: for `align="left"`, start from `t.left`; for `"right"`, start from `t.right - panel.width`. Then clamp to `[MARGIN, innerWidth - MARGIN - panel.width]`, using `MARGIN` when the panel is wider than the viewport.
5. The style is always `{ top, left }`. `right` is no longer used. The panel renders on open in a layout effect and is measured before paint, so there is no visible jump.
6. Updates run on open, on window `resize`, on capture-phase passive `scroll`, and through one `ResizeObserver` watching the trigger, the panel and, for tablist anchoring, the tablist. The observer is guarded by `typeof ResizeObserver !== "undefined"`. Everything is removed on close or unmount.

### 6.3 `PopoverOption` (named export of `shared/ui/Popover.tsx`)

- Props: `Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type">` plus:
  - `selected?: boolean`: committed value; text `text-focus-accent`.
  - `active?: boolean`: keyboard highlight; background `bg-pane-title`.
  - `tone?: "default" | "danger"`: `danger` gives `text-lifecycle-danger`.
- Element: `<button type="button">`. Any `role`, `id`, `aria-*`, `title`, `disabled`, `tabIndex`, `data-testid` or handler passes through.
- Single style: `flex w-full items-center gap-2 px-3 py-1.5 text-left text-base outline-none hover:bg-pane-title disabled:cursor-not-allowed disabled:opacity-50`, then `bg-pane-title` if active. Text colour is `text-lifecycle-danger` for danger tone, else `text-focus-accent` if selected, else `text-text-primary`. Hover and active share one look. Disabled rows keep their child colours, dimmed.
- Existing callers pass only `selected`, `onClick` and `children`, so they render as before plus the new disabled and outline defaults.

### 6.4 `useListNavigation` (default export of `shared/ui/useListNavigation.ts`)

Input `{ items, preferredId, onActivate }`:

- `items: readonly { id: string; disabled?: boolean }[]`: rows in visual order.
- `preferredId?: string | null`: fallback active row.
- `onActivate: (id: string) => void`

Output `{ activeId, setActiveId, onKeyDown }`:

- `activeId: string | null`: resolved active row. It is the stored id if that id is an enabled item; else `preferredId` if that is an enabled item; else the first enabled item; else null. This is derived during render, not in an effect.
- `setActiveId(id: string | null)`: stores an id. `null` means "use the fallback".
- `onKeyDown(event: KeyboardEvent<HTMLElement>)`: ignores the event if it is already `defaultPrevented` or has alt, ctrl, meta or shift. Handled keys get `preventDefault` and `stopPropagation`:
  - ArrowDown: next enabled item after the active one. It does not wrap; it stays on the last. With no active item it goes to the first enabled item.
  - ArrowUp: previous enabled item. It does not wrap; it stays on the first.
  - Home and End: first and last enabled item. Not handled when the event target is an `input` or `textarea`, so the caret keeps them.
  - Enter: `onActivate(activeId)` when there is an active item. Enter is always consumed, so it never leaks to host keymaps while a list is open.
  - Space: `onActivate(activeId)`, only when the target is not an `input` or `textarea`.
  - Escape, Tab and printable keys are not handled.

Clamping instead of wrapping is one behavior for all lists. `WorktreeSwitcher`'s tests (ticket 08) require it. The old dormant and launcher menus wrapped; that changes deliberately (D-4).

### 6.5 Menu and Listbox

#### 6.5.1 `Menu` (default export of `shared/ui/Menu.tsx`)

Props:

- `label: string`: `aria-label` of the `role="menu"` element.
- `items: readonly MenuEntry[]`
- `trigger: (props: MenuTriggerProps) => ReactNode`
- Pass-through to `Popover`: `align`, `anchor`, `portal`, `disabled`, `open`, `onOpenChange`, `triggerRef`, `className`, `data-testid`.

Types (exported):

- `MenuEntry = MenuItem | MenuHeading`.
- `MenuItem = { kind: "item"; id: string; label: ReactNode; onSelect: () => void; disabled?: boolean; ariaLabel?: string; title?: string; testId?: string; tone?: "default" | "danger"; keepOpen?: boolean }`.
- `MenuHeading = { kind: "heading"; id: string; label: string }`.
- `MenuTriggerProps = PopoverTriggerProps & { ariaProps: { "aria-haspopup": "menu"; "aria-expanded": boolean; "aria-controls": string | undefined } }`. `aria-controls` is the menu element id while open, otherwise `undefined`.

DOM inside the `Popover` panel:

- A `div` with `role="menu"`, `id` from `useId`, `aria-label={label}`, `tabIndex={-1}`, the hook's `onKeyDown`, and class `flex max-h-[60vh] flex-col overflow-y-auto`.
- Each `MenuItem` is a `PopoverOption` with `role="menuitem"`, `id`, `tabIndex={-1}`, `aria-label`, `title`, `disabled`, `data-testid`, `tone`, `active` equal to whether it is the active item, `onFocus` that sets it active, and `onClick` that activates it.
- Each `MenuHeading` is a `div` with `role="presentation"` and class `px-3 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wider text-text-muted`. Headings are not navigable.

Behavior:

- On open, the active item is reset to the first enabled item and receives DOM focus. With no enabled item, the menu element receives focus.
- Whenever the active item changes while open, it receives focus (`preventScroll`) and is scrolled into view with `scrollIntoView?.({ block: "nearest" })`.
- Activating an item through click, Enter or Space calls `onSelect`, then closes unless `keepOpen` is set. Focus is not moved on select.
- Escape and outside `pointerdown` behave as in `Popover`. Escape returns focus to the trigger.
- Menus do not dismiss on focus-out. Dormant resumes keep the menu open, and the old code had no focus-out dismissal.

#### 6.5.2 `Listbox` (default export of `shared/ui/Listbox.tsx`)

Props:

- `label: string`: `aria-label` of the `role="listbox"` element.
- `options: readonly ListboxOption[]`. `ListboxOption = { id: string; content: ReactNode; ariaLabel?: string; title?: string; disabled?: boolean }` (exported).
- `value?: string | null`: id of the committed value. When the prop is present (including `null`), `aria-selected` marks the value option and `PopoverOption.selected` is set on it. When it is `undefined`, the picker has no committed value, and `aria-selected` follows the active option (selection follows focus).
- `onSelect: (id: string) => void`: called after the list closes.
- `trigger: (props: ListboxTriggerProps) => ReactNode`
- `search?: ListboxSearch`:
  - `{ placement: "panel"; value: string; onChange: (value: string) => void; label: string; placeholder?: string }`: `Listbox` renders `PopoverSearch` as the first panel child.
  - `{ placement: "trigger"; value: string }`: the caller's trigger is the combobox input, wired with `comboboxProps`.
- `panel?: { role: "dialog" | "region"; label: string }`: becomes `Popover` `panelRole` and `panelLabel`.
- `header?: ReactNode`, `footer?: ReactNode`: rendered above and below the list inside the panel.
- `emptyLabel?: ReactNode`: rendered after the list, as a `div` with class `px-3 py-2 text-sm text-text-muted`, when `options` is empty.
- Pass-through to `Popover`: `align`, `anchor`, `portal`, `disabled`, `open`, `onOpenChange`, `triggerRef`, `className`, `data-testid`. `dismissOnFocusOut` is always on.

`ListboxTriggerProps = PopoverTriggerProps & { ariaProps; comboboxProps }`:

- `ariaProps`:
  - `aria-haspopup`: `"dialog"` when `panel.role` is `"dialog"`, else `"listbox"`.
  - `aria-expanded`: open.
  - `aria-controls`: `panelId` when `panel` is set, else the listbox id, while open; otherwise `undefined`.
- `comboboxProps` (only meaningful with `search.placement === "trigger"`):
  - Attributes: `ref` (the trigger callback ref), `role: "combobox"`, `aria-expanded: open`, `aria-controls` (listbox id, always), `aria-activedescendant` (active option DOM id while open, else `undefined`), `aria-autocomplete: "list"`, `autoComplete: "off"`.
  - `onFocus` and `onClick`: open when closed and not disabled.
  - `onKeyDown`:
    - Escape while open: `preventDefault`, `stopPropagation`, close, no focus move. While closed it is not handled and propagates.
    - ArrowDown or ArrowUp while closed: `preventDefault`, `stopPropagation`, open.
    - Otherwise: delegate to the hook while open.

DOM:

- The list is a `div` with `role="listbox"`, `id` from `useId`, `aria-label={label}`, and class `max-h-[320px] overflow-y-auto`.
- Each option is a `PopoverOption` with:
  - `role="option"`, `id` set to `${listboxId}-${option.id}`, `aria-selected` per the rule above, `aria-label`, `title`, `disabled`, `active`, and `selected` (value mode only).
  - `tabIndex={-1}`.
  - `onClick`: activate.
- In the two search modes, each option also gets `onMouseDown={preventDefault}` (focus stays in the input) and `onMouseMove` that sets it active.
- In focus mode, each option also gets `onFocus` that sets it active.

Focus modes:

1. Focus mode (no `search`): options take real DOM focus. The listbox element carries the hook's `onKeyDown`, so events bubble from the focused option. On open, and whenever the active option changes while focus is inside the panel or on `document.body`, the active option element (`document.getElementById`) is focused with `preventScroll`.
2. Panel-search mode (`placement: "panel"`): `PopoverSearch` receives `type="search"`, `role="combobox"`, `aria-label`, `aria-expanded="true"`, `aria-controls` (listbox id), `aria-activedescendant` (active option DOM id), `aria-autocomplete="list"`, `value`, `onChange`, `placeholder`, and the hook's `onKeyDown`. Its existing `autoFocus` focuses it on open. Escape bubbles to the `Popover` panel, which closes and returns focus to the trigger.
3. Trigger-combobox mode (`placement: "trigger"`): the caller's input carries `comboboxProps` and stays focused. Escape while open is handled in `comboboxProps`.

Active option rules:

- On every open, the active option resets to `value` if that is an enabled option, else the first enabled option.
- When `search.value` changes, the active option resets to the first enabled option.
- When the active option disappears from `options`, the hook's fallback applies (value, then first). Focus mode then refocuses per rule 1.
- The active option is scrolled into view (`scrollIntoView?.({ block: "nearest" })`) whenever it changes.

Selecting (click, Enter, Space in focus mode) closes the list, then calls `onSelect(id)`. Focus is not moved.

### 6.6 ARIA summary

| Surface | Roles | Focus model | Escape |
| --- | --- | --- | --- |
| `Menu` | trigger `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`; `menu` named by `label`; `menuitem`; heading `presentation` | Roving DOM focus, first enabled item on open | Close, focus trigger |
| `Listbox`, focus mode | trigger `aria-haspopup="listbox"` or `"dialog"`; `listbox` named by `label`; `option` with `aria-selected` | Roving DOM focus, value or first on open | Close, focus trigger |
| `Listbox`, panel search | `combobox` input with `aria-controls` and `aria-activedescendant` | Focus stays in the search field | Close, focus trigger |
| `Listbox`, trigger combobox | caller's `combobox` input | Focus stays in the input | Close while open; propagate while closed |

Native terminal occlusion: the `Popover` panel carries `data-native-terminal-overlay`, and the inner `menu` and `listbox` elements are nested in it. `useNativeWebViewSiblingInteraction` therefore reports exactly one frame per open panel, the panel's own rect. This also makes plain popovers (field pickers, worktree details) occlude native terminals, which they did not before. That is an intended fix (D-6).

### 6.7 Hooks preserved

| Hook | Where after migration |
| --- | --- |
| `data-testid="issue-actions-trigger"`, `aria-label="Issue actions"` | F-8 trigger button |
| `menu` named "Issue actions" | `Menu label` in F-8 |
| `data-testid="open-issue-terminal"`, `data-testid="delete-issue"` | `MenuItem.testId` in F-8 |
| `data-testid="dormant-tabs-trigger"`, `aria-label` `Dormant tabs (N)`, `aria-expanded` | F-9 trigger |
| `menu` named "Dormant tabs" with `max-h-[60vh] overflow-y-auto` | `Menu` list element class (6.5.1) |
| `menuitem` names `Resume …`, `Reopen …`, `Terminated …` | `MenuItem.ariaLabel` in F-9 |
| `menu` named "Launch agent"; `menuitem` "Plan" and "Instant"; button "＋ Agent" | F-10 |
| `data-testid` on every existing `Popover` wrapper (`state-picker`, `issue-type-picker`, `parent-picker`, `blocker-picker`) | unchanged `Popover` prop |
| `worktree-details`, "Show/Hide worktree details" | untouched `WorktreeBlock` |

## 7. Runtime flows and failure semantics

- Open: the trigger calls `onClick` or `onKeyDown`. `Popover` sets open (or calls `onOpenChange(true)` when controlled). The panel mounts and is measured in a layout effect. Menu or Listbox resets the active item and focuses per its mode.
- Navigate: a keydown reaches the hook through bubbling or the search input. The hook updates the active id. Menu and focus-mode Listbox move DOM focus; search modes update `aria-activedescendant`.
- Select: activation closes the panel (unless the item has `keepOpen`), then runs the item's `onSelect` or the Listbox `onSelect`. Errors thrown by an `onSelect` callback propagate as before. The panel is already closed, so no half-open state remains. Async work inside a callback (for example `createWorkItemShell` in F-8) keeps its existing `.catch` toast.
- Dismiss:
  - Escape returns focus to the trigger.
  - Outside `pointerdown` leaves focus where the pointer put it.
  - Focus-out (Listbox only) leaves focus at the new target.
  - `disabled` becoming true, or the owner unmounting (F-9 empty), closes it.
- Trigger missing at Escape time (unmounted or not focusable): the focus call is skipped. Close still happens.
- The trigger scrolls away while open: scroll tracking re-anchors the panel. If the trigger leaves the viewport, the panel follows it off-screen and is clamped horizontally only. This is acceptable because outside interaction closes it.
- Controlled owner refuses to open (`WorkspaceLauncher` task kind): the trigger never requests open, so the menu never mounts.
- Concurrency: `WorkspaceLauncher`'s identity guard (`openLauncherRef`, `launchCommittedRef`) stays in place. A context change while open closes the menu through the existing identity effect, which sets `launchOpen` false.

## 8. Ordered implementation plan

1. Extend `Popover` and `PopoverOption` (F-1). The props are additive, so all callers still compile. Write F-5 alongside.
   - Verify: F-5 green; the field-picker, `WorktreeBlock` and `WorkItemSearchList` guarding tests green.
   - Must not touch: any caller file.
2. Add `useListNavigation` (F-2). No caller yet.
   - Verify: typecheck.
3. Add `Menu` (F-3) and F-6.
   - Verify: F-6 green.
4. Add `Listbox` (F-4) and F-7, covering all three modes.
   - Verify: F-7 green.
5. Migrate `IssueActionsMenu` (F-8).
   - Verify: `overhaulTaskWorkspaceIdentifierAcceptance`, `overhaulNativeWebViewSiblingAcceptance`, `overhaulSubtreeRunAcceptance`.
6. Migrate `DormantWorkspaceTabs` (F-9).
   - Verify: `overhaulDormantWorkspaceTabsAcceptance` and the suites importing `dormantTabsFixture`.
7. Migrate `WorkspaceLauncher` (F-10).
   - Verify: `overhaulTaskAgentLaunchAcceptance`, `overhaulScratchAcceptance`, `overhaulTaskAgentLaunchInteractionAcceptance`, `overhaulEditViewNavigationAcceptance`.
8. Delete-check: none of F-8, F-9 or F-10 contains `addEventListener("pointerdown"`, `addEventListener("mousedown"`, `getBoundingClientRect`, `createPortal`, `ResizeObserver`, `"ArrowDown"` or `"Escape"`. No file outside `shared/ui` declares a `role="menu"` panel with `fixed` or `absolute` positioning.
   - Verify: `rg -n 'addEventListener\("(pointerdown|mousedown)"|getBoundingClientRect|createPortal|ResizeObserver|"ArrowDown"|"Escape"' studio/src/app/shell/ticket-workspace/selected-ticket/details/IssueActionsMenu.tsx studio/src/app/shell/ticket-workspace/selected-ticket/internal/DormantWorkspaceTabs.tsx studio/src/app/shell/ticket-workspace/selected-ticket/internal/WorkspaceLauncher.tsx` returns nothing.
9. Run the full gate: `npm run typecheck`, `npm run test --workspace @worktracker/studio`, `npm run test:overhaul --workspace @worktracker/studio`, `npm run build --workspace @worktracker/studio`.

## 9. Verification

### 9.1 New tests

These tests assert roles, names, focus and callbacks. They do not assert class strings, except in the positioning tests, which assert inline `top` and `left` styles.

`shared/ui/Popover.test.tsx`:

- Opens below the trigger: `top = bottom + 4`, `left = trigger.left`. Rects are mocked with `vi.spyOn(Element.prototype, "getBoundingClientRect")` per element, plus `window.innerHeight` and `innerWidth`.
- Flips above when the panel does not fit below and there is more room above.
- `align="right"` places the panel's right edge at the trigger's right edge and clamps it to 8px from the viewport edge.
- `anchor="tablist"` uses the tablist's bottom when it is lower than the trigger's.
- `portal` renders the panel as a child of `document.body`.
- The panel has `data-native-terminal-overlay` and, with `panelRole="dialog"`, is found by `getByRole("dialog", { name })`.
- Escape inside the panel closes it and focuses the trigger. Escape on the trigger closes it.
- `pointerdown` on `document.body` closes it. `pointerdown` inside the panel and on the trigger does not.
- Controlled mode: `onOpenChange(true)` on trigger click; the panel shows only when `open` is true.
- `disabled` becoming true closes it.
- `dismissOnFocusOut`: a blur with an outside `relatedTarget` closes it; a null `relatedTarget` does not.
- The trigger's Enter `keyDown` toggles open.

`shared/ui/Menu.test.tsx`:

- The trigger has `aria-haspopup="menu"` and `aria-expanded` reflecting state.
- `getByRole("menu", { name })`. Items are `menuitem`. A heading is not a `menuitem`.
- On open, the first enabled item has focus. ArrowDown and ArrowUp skip disabled items and stop at the ends. Home and End work.
- Enter calls `onSelect` and closes. Space does the same. A `keepOpen` item stays open after select.
- Escape closes and returns focus to the trigger. Outside `pointerdown` closes.
- A `danger` item and a disabled item are still `menuitem`; the disabled one `toBeDisabled()`.

`shared/ui/Listbox.test.tsx` (the hook is tested here):

- Panel search:
  - The combobox has focus, with `aria-controls` equal to the listbox id and `aria-activedescendant` equal to the first option id.
  - ArrowDown moves `aria-activedescendant`. With no `value`, `aria-selected="true"` follows it.
  - Changing the search value resets to the first option.
  - Enter calls `onSelect` with the id and closes.
  - Escape closes and focuses the trigger.
  - Clicking an option selects it.
- Focus mode:
  - Opening focuses the `value` option.
  - ArrowUp at the first option stays. End and Home move focus.
  - Space and Enter select.
  - Rerendering without the focused option moves focus to the value option.
  - Focusing an outside button closes it.
  - `aria-selected` marks `value`, not the active option.
- Trigger combobox:
  - Focus opens. ArrowDown while closed opens.
  - Escape while open closes and stops propagation (a parent `onKeyDown` spy is not called). Escape while closed reaches the parent spy.
  - Enter with no options calls nothing.
  - `emptyLabel` text is visible when there are no options.

### 9.2 Existing suites

All tests in 3.5, plus the full commands in step 9, must pass with no edits to existing test files.

### 9.3 Manual check (desktop, `npm run desktop:dev`)

Open the Resume menu and the scratch "＋ Agent" menu with a native terminal visible. The terminal yields to the menu, the menu sits under the tab strip, it flips above when the window is short, and Escape returns focus to the trigger. jsdom cannot observe native occlusion geometry or real flip in the packaged app, so this check stays manual.

## 10. Acceptance mapping

| Ticket criterion | Steps | Signal |
| --- | --- | --- |
| AC-1: `Menu.tsx`, `Listbox.tsx` and the hook exist; tests cover Escape, outside click, Up/Down/Home/End/Enter and focus return | 2, 3, 4 | F-6 and F-7 green; the hook is covered through F-7 |
| AC-2: the menus use `Menu`, and their dismissal and positioning code is deleted | 5, 6, 7, 8 | Migrated files contain no matches for the step 8 `rg`; guarding tests green. `WorktreeBlock` stays a `Popover` disclosure (D-7) |
| AC-3: one floating panel surface style (`Popover`'s) | 1, 5-7 | Only `shared/ui/Popover.tsx` defines the panel class; `rg -n 'bg-pane-panel py-1 shadow' studio/src` lists only `Popover.tsx` |
| AC-4: typecheck, studio tests and `test:overhaul` pass | 9 | Commands green |
| Story 6: Escape and outside click | 1 | F-5, F-6, F-7 |
| Story 9: one highlighted-option look | 1 (`PopoverOption`) | Single `active` style in 6.3 |
| Story 10: reposition on scroll and resize, flip | 1 | F-5 flip and anchor tests; manual check 9.3 |

## 11. Decisions and follow-ups

- D-1: `Popover` dismisses outside interaction on `pointerdown`, not `mousedown`. This matches `DormantWorkspaceTabs`, `WorkspaceLauncher` and `ModulePicker`, and no test depends on `mousedown`.
- D-2: Escape always returns focus to the trigger (sync, then again in `requestAnimationFrame`). Select and outside dismissal never move focus.
- D-3: Escape pressed inside a panel stops propagation. Escape caught by the document listener does not. Field pickers whose search input had Escape propagating to host handlers now only close the popover. Escape closes the innermost surface.
- D-4: List navigation clamps at the ends in every list. The dormant and launcher menus used to wrap.
- D-5: The portal is opt-in (`portal`). Only the tab-strip menus use it in this ticket, and `ModulePicker` will in ticket 08. Tests that query inside a feature region require in-place rendering for the rest.
- D-6: Every `Popover` panel carries `data-native-terminal-overlay`, so native terminals yield to all floating panels.
- D-7: `WorktreeBlock`'s "⋯" opens a details disclosure (summary text, path, conflict note, Discard with an inline confirm), not an action menu. `role="menu"` would be invalid for that content. Guarding tests also find Discard by role `button` (`WorktreeBlock.test.tsx:152`, `overhaulWorktreeDiscardRuntimeAcceptance:104`, `overhaulSelectedTaskWorktreeAcceptance:184`). It stays on `Popover` and inherits flip, clamp, `pointerdown` dismissal and Escape focus return. The ticket's "four menus" therefore become three `Menu` migrations plus one `Popover` disclosure.
- D-8: The single option row is `PopoverOption` with `text-base` and `px-3 py-1.5`. Menu rows that were `text-xs` or `text-sm` grow to this size.
- D-9: Menu typeahead is not built (YAGNI). "Type-to-filter" is the `Listbox` search field.
- Follow-up (not this ticket): move `WorkItemSearchList` and the field pickers (`StatePicker`, `WorkflowStatePicker`, `IssueTypePicker`) onto `Listbox` for arrow-key support. Their group headings would need a `Listbox` heading entry, as `Menu` has.
- Optional later swaps: trigger buttons onto `Button` variant `icon` or `dashed` (05); the `Menu` heading row onto `SectionHeading` `eyebrow` (10); `emptyLabel` onto `EmptyState` `inline` (10). None blocks this ticket.

Unresolved decisions: none.
