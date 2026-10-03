# LLD 08: Search pickers on Listbox

Status: implementation-ready (blocked by ticket 07 landing)
Work item: `.scratch/shared-ui-components/issues/08-search-pickers-on-listbox.md`
Parent story: `.scratch/shared-ui-components/spec.md` (Shared UI component library for Studio)
Module: Ticketry Studio frontend, `studio/src`
Depends on: `07-menu-listbox-on-popover/LLD.md`, which defines the `Popover`, `PopoverOption`, `useListNavigation` and `Listbox` contracts
Supersedes: nothing

## 1. Design basis

Authoritative inputs: the repository `CLAUDE.md`, the parent story ("Menu and Listbox", stories 7, 8, 9 and 10), the ticket, LLD 07 section 6 (the `Listbox` contract, used as-is), and the code and tests below.

This LLD moves three pickers onto `Listbox`:

- the module picker (header "+")
- the Changes worktree switcher
- the local merge destination picker

It deletes their hand-written outside-click handlers, positioning code, keyboard loops and the blur-based dismissal. It changes no file under `shared/ui/`. If 07's `Listbox` cannot express a need below, stop and amend LLD 07; do not patch around it here.

## 2. Scope and invariants

### In scope

- `features/module-tabs/ModulePicker.tsx`
- `features/agents/worktrees/changes/WorktreeSwitcher.tsx`
- `features/agents/worktrees/changes/MergeDestinationPicker.tsx`
- Deleting the now-unused checkout action set from `features/agents/worktrees/changes/changesKeyboardNavigation.ts`

### Invariants (must not change)

- Every role, accessible name and `data-testid` in section 6.3.
- Module picker:
  - The panel is `role="dialog"` named "Module picker" and is a direct child of `document.body`.
  - The search is `role="combobox"` named "Search modules".
  - The listbox is named "Module choices".
  - "Create new module" is always the first option.
  - Hidden-module filtering keeps canonical order (`eligibleModulePickerChoices`, unchanged).
- Worktree switcher:
  - Trigger named "Choose checkout", inside the "Changes commands" toolbar.
  - Panel `region` named "Worktree checkouts", containing listbox "Current worktree checkouts".
  - Options take real DOM focus. Opening focuses the selected checkout.
  - Up and Down stop at the ends.
  - Enter and Space select.
  - Escape returns focus to the trigger.
  - Focus leaving the switcher closes it without stealing focus back.
  - Rows refreshed while open keep focus. A removed focused row falls back to the selected row.
  - Load-failure, loading, empty and truncation lines stay inside the panel with their roles.
- Merge destination:
  - The page shows a `combobox` named "Local merge destination" whose value is the committed branch while closed.
  - Options render inside the "Local merge preview" region's DOM.
  - `aria-selected` marks the committed branch.
  - "No matching branches" shows for an empty filter.
  - Escape while open closes and restores the committed value. Escape while closed is left to the host.
  - Enter while closed does nothing.
  - The picker closes when `disabled`.
- `ChangesToolbar` arrow roving keeps ignoring the switcher while it is open (`[aria-expanded="true"]` trigger, options inside `[role="listbox"]`).

### Out of scope

- Any change to `shared/ui/*` (owned by 07).
- `WorkItemSearchList` and the Parent/Blocker/State/IssueType/WorkflowState field pickers. They are already on `Popover` + `PopoverSearch`; moving them to `Listbox` is the follow-up recorded in LLD 07 section 11.
- Restyling the merge combobox input. Ticket 06 `TextField` may later take over its class string.
- `app/navigation/keymapBindings.ts`. The six `changes.checkout.*` bindings stay so the keyboard settings panel keeps listing them (D-3).

## 3. Repository findings

### 3.1 Instances (verified against the current tree)

| File | Ticket lines | Verified | Code to delete |
| --- | --- | --- | --- |
| `features/module-tabs/ModulePicker.tsx` (259 lines) | 41-259; outside :69-82; anchoring :84-104; keyboard :147-169; options :223-247; own input :214 | outside pointerdown 69-82; fixed right-aligned anchoring 84-104; `closeAndRestoreFocus` 116-124; `handleFocusLeave` 126-135; keyboard 147-169 (Escape, Up/Down wrap, Enter); own `type="search"` combobox input 200-215; listbox and options 216-253; portal 189-256 | everything except `eligibleModulePickerChoices`, the query state, `useRestoreAndSelectModule`, and the trigger's look |
| `features/agents/worktrees/changes/WorktreeSwitcher.tsx` (167 lines) | 57-94, 147, 161 | `close` and `show` 47-56; document mousedown 57-64; `optionKey` via `resolveCaptureKeymapAction` 65-83; `triggerKey` 84-94; `handleBlur` 95-100; fallback effect 101-109; absolute `shadow-2xl` section 125; option class 147; status lines 159-162 | `optionRefs`, `ownsFocusRef`, `activeId`, the effects at 57-64 and 101-109, `optionKey`, `triggerKey`, `handleBlur`, and the `section`/`ul` markup |
| `features/agents/worktrees/changes/MergeDestinationPicker.tsx` (114 lines) | 60-109 | blur dismiss 42-47; `openRef` 13 and 25-38; key handling 69-90; `bg-pane-bg` absolute list 95-96; `bg-white/10` active row 101; scrollIntoView ref 100 | `openRef`, `highlighted`, the `onBlur`, `onKeyDown`, the disabled effect, and the `ul`/`li` markup |

The "▾" caret copies are at `WorkflowStatePicker.tsx:75`, `WorktreeSwitcher.tsx:122`, `MergeDestinationPicker.tsx:92` and `DormantWorkspaceTabs.tsx:167`. They are verified; D-5 settles them.

### 3.2 Couplings

- `ChangesToolbar.tsx:69-96`: the toolbar's `onKeyDown` returns early for `defaultPrevented` events and for targets inside `[role="dialog"]`, `[role="listbox"]` or `[aria-expanded="true"]`. Its roving set excludes controls inside a dialog or listbox. `Listbox`'s hook calls `preventDefault` and `stopPropagation` on handled keys, and the trigger keeps `aria-expanded`, so the toolbar ignores the open switcher as before.
- `changesKeyboardNavigation.ts:1-15`: `CHANGES_CHECKOUT_ACTIONS` and `ChangesCheckoutAction` are referenced only by `WorktreeSwitcher.tsx`. The file's `CHANGES_FILE_ACTIONS` is used by `ChangedFilesList.tsx` and stays.
- `app/navigation/keymapBindings.ts:116-151`: the `changes.checkout.*` chords are fixed (`configurable: false`). They are ArrowUp, ArrowDown, Home, End, Enter (plus a Space alias) and Escape, exactly the keys `useListNavigation` and `Popover` handle. `features/studio/modals/KeyboardSettingsPanel.tsx:28-33` labels them for display.
- `WorktreeSwitcher.tsx:43-46`: a `requestAnimationFrame` focus of the trigger on every `selectedTaskId` change. It is not menu code and stays.

### 3.3 Guarding tests (must stay green unchanged)

| Test | Pins |
| --- | --- |
| `src/test/overhaulModulePickerAcceptance.test.tsx` (all cases) | trigger "Open module picker"; `dialog "Module picker"` whose `parentElement` is `document.body`; combobox "Search modules" has focus with `aria-controls` equal to the listbox id and `aria-activedescendant` equal to the create option, then the restore option after ArrowDown, with `aria-selected="true"` on it; search change resets to create; Escape closes and focuses the trigger; reopen clears the query; trigger re-click closes (pointerDown + mouseDown + blur toward trigger); `pointerDown(document.body)` closes; blur toward a tab closes and leaves focus there; arrows + Enter restore a hidden module; create opens `add-module` |
| `src/test/overhaulChangesWorkspaceNavigationAcceptance.test.tsx:240-350, 540-625` | `keyDown(trigger, Enter or Space)` opens; the selected row has focus; Up/Down clamp; Home/End; Escape keeps focus local and returns it to the trigger; Enter and Space select; `aria-expanded="false"` right after selecting; refreshed row keeps focus; removed row falls back to the module row; focusing "After Changes toolbar" closes without moving focus |
| `src/test/overhaulWorktreeSwitcherFailureAcceptance.test.tsx:51-63` | Enter opens even when loading failed; `alert` "Unable to load worktree checkouts."; module row focused; Enter selects |
| `src/test/overhaulModuleVersionControlAcceptance.test.tsx:221-245, 456-470, 579-585` | `region "Worktree checkouts"` contains `listbox "Current worktree checkouts"`; option names; `aria-selected="true"` on the selected row; the same option node survives a refresh |
| `src/test/changesSurface.ts:19-21` | opener helper: click "Choose checkout", then find `region "Worktree checkouts"` |
| `src/test/overhaulChangesZoneArrowAcceptance.test.tsx:60-90` | trigger inside `toolbar "Changes commands"`; ArrowRight and ArrowLeft roving from the trigger |
| `overhaulChangesActionsAcceptance:142`, `overhaulChangesWorkspaceRecoveryAcceptance:129`, `overhaulTaskWorktreeChangesAcceptance:132` | trigger focus after actions; region visible |
| `src/test/overhaulTaskWorktreeChangesAcceptance.test.tsx:1081-1112, 1176-1190` | combobox value "release/2.1" while closed; `fireEvent.focus` opens; option text order; `aria-selected="true"` on release/2.1; "No matching branches"; Enter (and repeated Enter) with no match reads nothing; Escape restores value and removes the listbox; click opens; "MAIN" filter, ArrowDown, Enter selects main exactly once; clicking an option selects it |

## 4. Preflight gates

- G-1: Ticket 07 is merged. `shared/ui/Listbox.tsx` exports `Listbox` and `ListboxOption`, and its contract matches LLD 07 section 6.5.2: `search.placement` `"panel"` and `"trigger"`, `panel`, `header`, `footer`, `emptyLabel`, `value`, controlled `open`, `triggerRef`, `className`, `data-testid`, and trigger props `ariaProps` and `comboboxProps`. If any of these is missing, stop and amend 07 first.
- G-2: `npm run typecheck`, `npm run test --workspace @worktracker/studio` and `npm run test:overhaul --workspace @worktracker/studio` are green before starting.
- G-3: If any test in 3.3 would need an edit, stop. This ticket changes no assertion.

## 5. File and component change map

| # | Path (under `studio/src/`) | Action | Responsibility after change |
| --- | --- | --- | --- |
| F-1 | `features/module-tabs/ModulePicker.tsx` | modify | Builds module-picker options (create plus hidden modules), owns the query, and routes the chosen option to create or restore |
| F-2 | `features/agents/worktrees/changes/WorktreeSwitcher.tsx` | modify | Builds checkout options and status lines from `useWorktreeCheckouts`; opens the chosen checkout and returns focus to its trigger |
| F-3 | `features/agents/worktrees/changes/MergeDestinationPicker.tsx` | modify | Filters destinations, owns the query and open state, and renders its combobox input as the `Listbox` trigger |
| F-4 | `features/agents/worktrees/changes/changesKeyboardNavigation.ts` | modify | Keeps only the file-list action set |
| U-1 | `shared/ui/Listbox.tsx`, `shared/ui/Popover.tsx`, `shared/ui/useListNavigation.ts`, `shared/ui/PopoverSearch.tsx` | untouched | Contract from 07 |
| U-2 | `features/agents/worktrees/changes/ChangesToolbar.tsx` | untouched | Its listbox and expanded guards keep working |
| U-3 | `app/navigation/keymapBindings.ts`, `features/studio/modals/KeyboardSettingsPanel.tsx` | untouched | The checkout chords remain listed (D-3) |
| U-4 | `features/agents/worktrees/changes/worktreeCheckoutRows.ts`, `useWorktreeCheckouts.ts` | untouched | Row data and `checkoutToneClass` |
| U-5 | `features/module-tabs/useRestoreAndSelectModule.ts`, `modulePresentation.ts` | untouched | Restore flow and hidden ids |

### F-1 `ModulePicker.tsx` (modify)

- Delete the imports of `CSSProperties`, `FocusEvent`, `KeyboardEvent`, `useEffect`, `useLayoutEffect`, `useRef` and `createPortal`. Delete the state `activeIndex` and `dialogPosition`, the refs `containerRef`, `dialogRef`, `triggerRef` and `searchRef`, `validActiveIndex`, `activeChoiceId`, all three effects, `togglePicker`, `closeAndRestoreFocus`, `handleFocusLeave`, `handlePickerKeyDown`, and `DIALOG_ID`, `CHOICES_ID` and `CREATE_CHOICE_ID`.
- Keep `eligibleModulePickerChoices` (exported, unchanged), `useState` for `query`, and `useRestoreAndSelectModule`.
- Add `const CREATE_OPTION_ID = "create";`.
- Options: `[{ id: CREATE_OPTION_ID, content: "Create new module" }, ...choices.map((module) => ({ id: module.id, content: <span className="truncate">{module.name}</span>, ariaLabel: "Restore " + module.name + " module tab" }))]`.
- Render `Listbox` with:
  - `label="Module choices"`, `panel={{ role: "dialog", label: "Module picker" }}`, `align="right"`, `portal`, `className="flex h-full shrink-0"`
  - `search={{ placement: "panel", value: query, onChange: setQuery, label: "Search modules", placeholder: "Search modules" }}`
  - `onOpenChange={(next) => { if (next) setQuery(""); }}`
  - `onSelect={(id) => id === CREATE_OPTION_ID ? onCreate() : restoreAndSelectModule(id)}`
  - No `value` prop, so `aria-selected` follows the active option, as the test requires.
- Trigger: a `button` with `ref={triggerRef}`, `type="button"`, `aria-label="Open module picker"`, `{...ariaProps}` (`aria-haspopup="dialog"`, `aria-expanded`, `aria-controls` equal to the panel id), `onClick` and `onKeyDown`, the existing class, and "+".
- Expected result: about 70 lines.
- Verify: `overhaulModulePickerAcceptance`, `overhaulModuleJumpBadgesAcceptance`, `overhaulModuleCreationAcceptance`, `overhaulModuleVisibilityAcceptance`.

### F-2 `WorktreeSwitcher.tsx` (modify)

- Delete the imports of `FocusEvent`, `KeyboardEvent`, `resolveCaptureKeymapAction`, `CHANGES_CHECKOUT_ACTIONS` and `ChangesCheckoutAction`. Delete the refs `rootRef`, `optionRefs` and `ownsFocusRef`, the state `open` and `activeId`, `rowIds`, `close`, `show`, the effects at 57-64 and 101-109, `optionKey`, `triggerKey` and `handleBlur`.
- Keep `useWorktreeCheckouts`, `rowId`, `isSelected`, `selectedIndex`, `current`, `taskRows`, `triggerRef`, and the `selectedTaskId` focus effect (43-46).
- Rewrite the header comment (12-21): the switcher is a `Listbox` in focus mode. The arrow, Home, End, Enter/Space and Escape behavior comes from `useListNavigation` and `Popover`, and matches the fixed `changes.checkout.*` chords.
- Options: `rows.map((row) => ({ id: rowId(row.taskId), ariaLabel: "Open " + row.label + " Changes", content: … }))`. Content is the existing dot, label/branch block and summary spans (lines 149-154), unchanged.
- Render `Listbox` with:
  - `label="Current worktree checkouts"`, `panel={{ role: "region", label: "Worktree checkouts" }}`, `data-testid="changes-worktree-switcher"`, `triggerRef={triggerRef}`
  - `value={current ? rowId(current.taskId) : null}`, so `aria-selected` marks the selected checkout and opening focuses it
  - `header`: the existing `<header>` block (lines 126-129)
  - `footer`: the existing alert, status, empty and truncation lines (159-162), unchanged
  - `onSelect`: `(id) => { requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true })); const row = rows.find((r) => rowId(r.taskId) === id); if (!row) return; if (row.taskId === null) onOpenModule(); else onOpenTask(row.taskId); }`
- Trigger: the existing `button` (line 118) with `ref={triggerRef}`, `{...ariaProps}` (`aria-haspopup="listbox"`, `aria-expanded`), `onClick`, `onKeyDown` (Enter or Space toggles with `stopPropagation`; ArrowDown is not handled, so the toolbar's "Down enters review" keeps working), `aria-label="Choose checkout"` and the existing class and children, including the caret.
- Expected result: about 75 lines.
- Verify with the switcher rows of 3.3.

### F-3 `MergeDestinationPicker.tsx` (modify)

- Delete `useEffect` and `useRef`, `openRef`, `highlighted`, `activeIndex`, `show`, `select`, the disabled effect, the wrapper `onBlur`, the input `onKeyDown`, `onFocus` and `onClick`, and the `ul`/`li` markup.
- Keep `useId` for the description id (`${id}-order`), `open` and `search` state, and `matches`.
- Options: `matches.map(({ branch, checkout }) => ({ id: branch, content: <span className="min-w-0"><span className="block break-all">{branch}</span><span className="block break-all text-text-muted">{checkout ?? "Not checked out"}</span></span> }))`. The option `textContent` stays `branch + checkout`.
- Render `Listbox` with:
  - `label="Local branches"`, `className="mt-2"`, `disabled={disabled}`
  - `value={value}`, `search={{ placement: "trigger", value: search }}`, `emptyLabel="No matching branches"`
  - controlled `open={open}` and `onOpenChange={(next) => { if (next) setSearch(""); setOpen(next); }}`
  - `onSelect={onSelect}`
- Trigger render: a `<span className="relative block">` holding:
  - the existing `input`, with `{...comboboxProps}` and its own `aria-label="Local merge destination"`, `aria-describedby={`${id}-order`}`, `disabled`, `placeholder`, `value={open ? search : value ?? ""}`, the existing class, and `onChange={(event) => { setSearch(event.target.value); setOpen(true); }}`
  - the existing "▾" span
- The `<p id={`${id}-order`}>` "Most recent commits first" line stays immediately after the `Listbox`, outside the trigger.
- Expected result: about 55 lines.
- Verify: `overhaulTaskWorktreeChangesAcceptance` cases `[overhaul-399]` and the merge-preview case at 1081-1112.

### F-4 `changesKeyboardNavigation.ts` (modify)

- Delete `CHANGES_CHECKOUT_ACTIONS` and `ChangesCheckoutAction` (lines 1-15). Keep `CHANGES_FILE_ACTIONS` and `ChangesFileAction`.
- Verify: typecheck. `rg -n "CHANGES_CHECKOUT_ACTIONS|ChangesCheckoutAction" studio/src` returns nothing.

## 6. Contracts

### 6.1 Listbox usage per picker (07 contract, no extensions)

| Picker | Focus mode | `value` | `panel` | `portal` | Notes |
| --- | --- | --- | --- | --- | --- |
| ModulePicker | panel search | omitted (selection follows focus) | dialog "Module picker" | yes | `align="right"`; query reset on open |
| WorktreeSwitcher | focus (DOM focus on options) | current checkout id | region "Worktree checkouts" | no | `header` and `footer` slots; focus returned to the trigger on select |
| MergeDestinationPicker | trigger combobox | committed branch | none | no | controlled `open`; `emptyLabel`; `disabled` closes |

### 6.2 Behavior changes accepted by this ticket

- ModulePicker: Up and Down no longer wrap between the first and last option; they stop at the ends (LLD 07 D-4). Pressing Home or End in the search field moves the caret.
- ModulePicker panel and switcher panel use the shared surface: `w-max min-w-[200px] max-w-[380px]`, `py-1`, `shadow-2xl`. They lose `w-64`, `p-1` and `min-w-[22rem]` (LLD 07 6.1). The switcher's list scroll cap goes from `max-h-[22rem]` to the shared `max-h-[320px]`.
- WorktreeSwitcher: the selected row's inset accent bar is replaced by the shared `selected` text colour plus the shared active background.
- MergeDestinationPicker:
  - The panel is the shared fixed-position surface instead of an input-width absolute list.
  - Opening makes the committed branch active (07 active-on-open rule) instead of the first match, so Enter right after opening re-selects the committed branch.
  - Blur with a null `relatedTarget` no longer closes the list; an outside `pointerdown` still does.
- Option text size is the shared `PopoverOption` `text-base` everywhere (LLD 07 D-8).

### 6.3 Hooks preserved

| Hook | Where |
| --- | --- |
| button "Open module picker" | F-1 trigger |
| dialog "Module picker" (child of `document.body`) | `panel` + `portal` in F-1 |
| combobox "Search modules"; listbox "Module choices"; option "Create new module"; options "Restore … module tab" | F-1 `search`, `label`, options |
| button "Choose checkout"; `data-testid="changes-worktree-switcher"` | F-2 trigger and `data-testid` |
| region "Worktree checkouts"; listbox "Current worktree checkouts"; options "Open … Changes" | F-2 `panel`, `label`, options |
| alert "Unable to load worktree checkouts."; status lines | F-2 `footer` |
| combobox "Local merge destination"; listbox "Local branches"; text "No matching branches" | F-3 input, `label`, `emptyLabel` |

## 7. Runtime flows and failure semantics

- Module picker: the trigger is clicked or receives Enter. `onOpenChange(true)` clears the query. The dialog portals and the search autofocuses with create active. Typing filters through `eligibleModulePickerChoices` and resets the active option to create. Enter or a click closes the picker, then creates or restores. Restore failures stay inside `useRestoreAndSelectModule`, unchanged.
- Worktree switcher:
  - Enter or Space on the trigger opens it; the selected row is focused.
  - Checkout query refreshes rerender the options in place. A removed active row falls back to the value row, then the first row, and is refocused while focus is in the panel or on `document.body`.
  - Load failure still renders the module row (from `useWorktreeCheckouts`) and the alert footer.
  - Selecting closes, schedules trigger focus, then opens the module or task Changes. An unknown id (a row removed between render and select) is ignored after closing.
- Merge destination:
  - Focus, click, ArrowDown or ArrowUp opens the list and clears the search. Typing opens the list and filters.
  - Enter selects the active match. With no match, nothing happens and the list stays open.
  - Escape closes and the input shows the committed value again.
  - `disabled` becoming true closes the list through `Popover`, which calls `onOpenChange(false)`.
  - Selecting closes the list, then calls `onSelect(branch)`. Repeated Enter after closing hits the closed combobox and does nothing.

## 8. Ordered implementation plan

1. Confirm G-1 to G-3.
2. Migrate `ModulePicker` (F-1).
   - Verify: `npx vitest run src/test/overhaulModulePickerAcceptance.test.tsx` from `studio/`.
   - Must not touch: `shared/ui`, `ModuleTabStrip`.
3. Migrate `WorktreeSwitcher` (F-2), then delete the checkout set (F-4).
   - Verify: the switcher rows of 3.3 and typecheck.
   - Must not touch: `ChangesToolbar`, `keymapBindings`.
4. Migrate `MergeDestinationPicker` (F-3).
   - Verify: `overhaulTaskWorktreeChangesAcceptance`.
5. Delete-check.
   - Verify: `rg -n 'addEventListener|getBoundingClientRect|createPortal|"ArrowDown"|"ArrowUp"|"Escape"|onBlur|scrollIntoView|bg-white/10|shadow-2xl' studio/src/features/module-tabs/ModulePicker.tsx studio/src/features/agents/worktrees/changes/WorktreeSwitcher.tsx studio/src/features/agents/worktrees/changes/MergeDestinationPicker.tsx` returns nothing.
6. Run the full gate: `npm run typecheck`, `npm run test --workspace @worktracker/studio`, `npm run test:overhaul --workspace @worktracker/studio`, `npm run build --workspace @worktracker/studio`.

## 9. Verification

- New tests: none. Every behavior this ticket must keep is already pinned at the acceptance seam (3.3). `Listbox`'s three modes are unit-tested in 07 (`shared/ui/Listbox.test.tsx`). A new colocated test here would duplicate both.
- Existing suites: everything in 3.3, plus the full commands in step 6, unchanged.
- Manual check (`npm run web`, then `npm run desktop:dev`), for behavior jsdom cannot show:
  - Open each picker near the bottom of a short window: the panel flips above.
  - Scroll the Changes pane with the switcher open: the panel follows.
  - With a native terminal visible: the module picker dialog occludes it.

## 10. Acceptance mapping

| Ticket criterion | Steps | Signal |
| --- | --- | --- |
| AC-1: all three pickers use `Listbox`; keyboard, filtering and selection behave as before | 2, 3, 4 | `rg -n "shared/ui/Listbox"` lists the three files; the 3.3 suites are green unchanged; the deliberate deltas are listed in 6.2 |
| AC-2: no hand-rolled outside-click, positioning or arrow-key code remains in these files | 5 | Step 5 `rg` returns nothing; F-4 `rg` returns nothing |
| AC-3: typecheck, studio tests and `test:overhaul` pass | 6 | Commands green |
| Story 8: one search field | 2 | ModulePicker uses `PopoverSearch` through `Listbox`. The merge picker's input is an inline combobox by contract (D-2) |
| Story 10: reposition and flip | 2, 3, 4 | Inherited from `Popover` (07 F-5); manual check |

## 11. Decisions

- D-1: The worktree switcher uses `Listbox` focus mode (real DOM focus on options), not `aria-activedescendant`. Its acceptance tests assert `toHaveFocus()` on options, and it has no search field.
- D-2: The merge destination picker uses the trigger-combobox mode, with its own input as the `Listbox` trigger, rather than a button trigger plus `PopoverSearch`. The guarding tests require a page-level combobox showing the committed value while closed, and options inside the "Local merge preview" region's DOM. So the merge picker does not use `PopoverSearch`. Its input styling stays local until ticket 06's `TextField` can take it.
- D-3: `CHANGES_CHECKOUT_ACTIONS` and its type are deleted because nothing consumes them after F-2. The `changes.checkout.*` keymap bindings stay, because they are fixed, match the hook's keys exactly, and feed the keyboard settings list. Removing them would change Settings, which is out of scope.
- D-4: Focus after selecting is the caller's job: the switcher refocuses its trigger; the module picker and merge picker do not. This matches each picker's current behavior.
- D-5: The "▾" caret is not a `Button` slot in this ticket. Each trigger keeps its own caret span: `WorktreeSwitcher.tsx:122`, `MergeDestinationPicker.tsx:92`, and untouched `WorkflowStatePicker.tsx:75` and `DormantWorkspaceTabs.tsx:167`. `Listbox` does not render a caret. When ticket 05 lands, a `Button` `trailing` caret is an optional swap for the three button triggers. The merge caret overlays an input, so it stays local.

Unresolved decisions: none.
