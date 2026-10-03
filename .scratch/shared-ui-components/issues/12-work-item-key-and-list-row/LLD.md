# LLD 12: WorkItemKey and WorkItemListRow

| Field | Value |
| --- | --- |
| Work item | `issues/12-work-item-key-and-list-row.md` |
| Parent | `.scratch/shared-ui-components/spec.md` (Story: Shared UI component library for Studio) |
| Module | Ticketry Studio frontend, `studio/src` |
| Blocked by | Ticket 11. Uses `shared/ui/StatusDot.tsx` and `shared/ui/Chip.tsx` exactly as `11-status-dot-chip-and-tones/LLD.md` sections 4.2 and 4.3 define them |
| Baseline | `main` at `a2541323` plus ticket 11. Line numbers below are from `a2541323` |
| Status | Ready to implement. No user decision is open |

## 1. Design basis

The spec, the ticket and the user's direction are authoritative. The user chose one state style everywhere: the square state chip, a square dot followed by the state name (for example "■ Ideas"). It replaces the tinted pill in `FindingsPanel`.

Per the repository `CLAUDE.md` and the spec's "Location" decision, the two components below live in the work-items feature and are exported from `features/work-items/index.ts`. They sit at the feature root, next to the existing display components `WorkItemSearchList.tsx` and `FindingLocationLabel.tsx`. The feature's `api`/`queries`/`selectors`/`internal` split holds data and state code, so display components do not go there.

This LLD delivers:

- `WorkItemKey`: the formatted display identifier in the shared key style, optionally in the state colour.
- `WorkItemListRow`: a state `StatusDot`, the key, the name, a trailing slot, and click and selected states.
- Child issues, review findings and the work-item search list all render through `WorkItemListRow`.
- The Stories-tree label renders its key through `WorkItemKey`.

## 2. Scope and invariants

### 2.1 In scope

- Create `WorkItemKey` and `WorkItemListRow`, each with a colocated test, and export both from `features/work-items/index.ts`.
- Migrate `ChildIssues`, `FindingsPanel` and `WorkItemSearchList` to `WorkItemListRow`. Delete `WorkItemSearchList`'s private `Identifier`.
- Replace the tinted finding-state pill with the square state chip.
- Make `WorkItemRowLabel` render its key through `WorkItemKey`. Rename the label's `identifier: string` input to `sequenceId: number | null` along the tree-row path (`PlanningRowView`, `TaskRow`, `ConversationRows`).

### 2.2 Invariants (must not change)

- **Stories-tree label.** It is one `span[data-task-label]` with `min-w-0 flex-1 truncate`, containing the key `span[data-task-id-token]`, then a muted " · ", then `span[data-task-name]` with `font-mono font-normal`. Only the key carries the inline state colour; a null colour gives `text-text-muted`. A row with no sequence id renders the name alone, with no separator, no token and never a tracker key. These properties are asserted by `src/test/overhaulWorkItemRowAcceptance.test.tsx:76-140` and `overhaulDescriptionSelectionAcceptance.test.tsx:76`.
- **Hooks.** `data-testid` values `child-issues`, `findings-panel`, `findings-list`, `finding-row`, `finding-state`, `finding-cancel`, `finding-location`, `findings-queued-count`, `add-subtask` and `add-subtask-type` keep their names and the elements they sit on.
- **Accessible names.**
  - A child-issue row is a button whose name contains its key and its name (`e2e/web-app.spec.ts:774,1757`).
  - A finding row's first button selects the finding (`e2e/web-app.spec.ts:1588`).
  - The Cancel button keeps the name `Cancel <key>`, or `Cancel finding` when the item has no key.
  - Picker options keep their text (`overhaulReparentConvergenceAcceptance.test.tsx:68`, name `/Module 2/`).
- **Finding state text.** `finding-state` text equals the state label exactly ("Implement", "Cancelled"). The square is a decorative `StatusDot` with no text (`e2e/web-app.spec.ts:1586,1598`).
- **Search.** `WorkItemSearchList` filtering, selection, the empty row and the group headings behave as before (`features/work-items/WorkItemSearchList.test.tsx`, unchanged).
- **Untouched surfaces.** `PlanningRowView` keeps its own row, drag props, caret, badges and trailing slot. Only the type of one prop changes.

### 2.3 Out of scope and hand-offs

| Item | Disposition |
| --- | --- |
| `IssueDetail.tsx:241` | Untouched. The identifier is interpolated into the delete-confirm body text, so it is a string, not a rendered key. |
| `fields/ParentPicker.tsx:54` | Untouched. The identifier composes the trigger label and title strings. The picker list it opens is migrated through `WorkItemSearchList`. |
| `Breadcrumb.tsx:31,70-78` | Untouched. `issue-identifier` is a breadcrumb crumb in `text-text-primary`, not a key cell. Restyling it would change the breadcrumb. |
| `BlockerChipView.tsx:22-23` | Untouched here. Its identifier falls back to `chip.id.slice(0, 8)` and sits inside a `Chip` that ticket 11 provides. `WorkItemKey` deliberately has no fallback text (4.1). |
| `WorkItemSearchList`'s `GroupHeading`, the empty states in `ChildIssues` and `WorkItemSearchList`, the "Child issues" and "Review findings" headings | Ticket 10 |
| `ChildIssues` select and input | Ticket 06 |
| `FindingsPanel` Cancel button styling | Ticket 05 |
| `PopoverOption` styling and roles | Ticket 07. `WorkItemSearchList` keeps `PopoverOption` as its option wrapper. |
| `PlanningRowView` and the Stories tree | Out of scope by the spec, apart from the prop rename in 2.1 |
| New Tailwind tokens | Not needed |

### 2.4 Deliberate visible changes

| Surface | Before | After |
| --- | --- | --- |
| Finding state | Text tinted in the state colour, on a 13% background in the same colour | `Chip size="sm"` (neutral outline, `text-text-secondary`) with a leading `StatusDot` in the state colour |
| Finding location | Inside the select button, so it was part of that button's accessible name | In the trailing slot, outside the button. The button's name is now key plus name, matching child issues |
| Module rows in `WorkItemSearchList` | The name had `truncate` only | The name has `min-w-0 flex-1 truncate`, the same as task rows |

## 3. Repository findings and preflight

### 3.1 Verified instances (paths relative to `studio/src`)

| Ticket reference | Verified location | Disposition |
| --- | --- | --- |
| Key cell `WorkItemSearchList.tsx:104` (`Identifier`) | `features/work-items/WorkItemSearchList.tsx:106-112` (definition), used at `:76` and `:84`. `taskLeading` is declared at `:34-35` and used at `:83` | Delete `Identifier`. Rows become `WorkItemListRow variant="option"` |
| Key cell `ChildIssues.tsx:54` | `app/shell/ticket-workspace/selected-ticket/details/ChildIssues.tsx:54-56` | Through `WorkItemListRow` |
| Key cell `FindingsPanel.tsx:65` | `.../details/FindingsPanel.tsx:65-67` | Through `WorkItemListRow` |
| Row body `ChildIssues.tsx:47` | `ChildIssues.tsx:44-58` (whole-row button, with the dot at `:50-53`, which ticket 11 turned into a `StatusDot`) | `WorkItemListRow` with `onClick` and `stateColor` |
| Row body `FindingsPanel.tsx:59` | `FindingsPanel.tsx:55-90` (a `finding-row` div holding the select button with key, name and `FindingLocationLabel`, then the state pill at `:71-77`, then Cancel at `:78-89`) | `WorkItemListRow` with location, state chip and Cancel as `trailing` |
| Tree label | `app/shell/ticket-workspace/tasks/components/WorkItemRowLabel.tsx:16-38`. Its single caller is `PlanningRowView.tsx:113-119`. `PlanningRowView.tsx:30` declares `identifier: string`. `TaskRow.tsx:91` passes the formatted string, and `ConversationRows.tsx:58,132` pass `""` while also supplying `label` | `WorkItemKey variant="inline"`, with `sequenceId` threaded through |
| Other identifier renderers | `IssueDetail.tsx:241`, `BlockerChipView.tsx:23`, `Breadcrumb.tsx:31`, `fields/ParentPicker.tsx:54` | Checked. All untouched (2.3) |
| State style | `FindingsPanel.tsx:71-77` | Square state chip |

Searching for `formatWorkItemDisplayIdentifier` across `studio/src` finds no other rendered key cell. The remaining callers compose strings: `TaskRow` (removed by this ticket), `IssueDetail`, `Breadcrumb`, `ParentPicker`, `BlockerChipView` and `FindingsPanel`, which keeps it for the Cancel label.

### 3.2 Preflight gates

- P-1. Ticket 11 has landed. `shared/ui/StatusDot.tsx` and `shared/ui/Chip.tsx` exist with the props in LLD 11 sections 4.2 and 4.3, and `BlockerPicker.tsx` renders `StatusDot` through `taskLeading`. If either component is missing, stop. Do not create stand-ins.
- P-2. On the baseline, `npm run typecheck`, `npm run test --workspace @worktracker/studio` and `npm run test:overhaul` all pass.

## 4. Contracts

### 4.1 `WorkItemKey`: `features/work-items/WorkItemKey.tsx` (named export)

| Prop | Type | Default | Behaviour |
| --- | --- | --- | --- |
| `sequenceId` | `number \| null \| undefined` | required | Formatted with `formatWorkItemDisplayIdentifier`, so `T-<n>` or `""` |
| `stateColor` | `string \| null` | — | When truthy, applied as inline `style.color`. Otherwise the key gets `text-text-muted` |
| `variant` | `"cell" \| "inline"` | `"cell"` | `cell` is the fixed-width list column: `w-20 flex-none font-mono text-xs`. `inline` inherits size and face, for the tree label |

What it renders:

- **Element.** One `<span data-task-id-token>` whose only text is the identifier.
- **`inline` with an empty identifier.** Renders nothing (`null`).
- **`cell` with an empty identifier.** Still renders the empty span, so the column stays aligned. It never renders "T-null" or "T-undefined".
- **No fallback.** There is no fallback-text prop, because callers that need a stub, such as `BlockerChipView`, compose their own string.
- **Single key style.** `data-task-id-token` is the key's stable hook on every surface. No other class or prop restyles the key.

### 4.2 `WorkItemListRow`: `features/work-items/WorkItemListRow.tsx` (named export)

| Prop | Type | Default | Behaviour |
| --- | --- | --- | --- |
| `sequenceId` | `number \| null \| undefined` | required | Rendered with `WorkItemKey variant="cell"` |
| `name` | `string` | required | Rendered in `span.min-w-0.flex-1.truncate`. In `list` the span also has `text-base text-text-primary`. In `option` the name inherits the option's colour, so `PopoverOption`'s selected accent still applies |
| `stateColor` | `string \| null` | — | When the prop is present (even if `null`), a leading `StatusDot color={stateColor}` is rendered, and a null colour falls back to the muted tone. When it is absent, no dot is rendered |
| `variant` | `"list" \| "option"` | `"list"` | `list` is a bordered list row. `option` is bare row content placed inside an interactive option (`PopoverOption`) that owns hover, selection and click |
| `onClick` | `() => void` | — | `list` only (enforced by the type). Makes the dot, key and name region a `<button type="button">` |
| `selected` | `boolean` | `false` | `list` only. Adds `bg-pane-title` on the root and `aria-current="true"` on the button |
| `trailing` | `ReactNode` | — | Rendered after the primary region, as its sibling and never inside the button, so it may contain buttons |
| `data-testid` | `string` | — | Forwarded to the root |

Element structure:

- **`list` root.** `<div>` with `flex items-center gap-2.5 border-b border-pane-border/60 px-3 py-2 last:border-b-0 hover:bg-pane-title`.
- **`list` primary region.** With `onClick` it is a `<button type="button">` with `flex min-w-0 flex-1 items-center gap-2.5 text-left`. Without `onClick` it is a `<span>` with the same layout.
- **`option` root.** `<span>` with `flex min-w-0 flex-1 items-center gap-2`, holding the dot, key, name and trailing directly. It renders no button.
- **Contents.** Both variants render, in order: the optional `StatusDot`, then `WorkItemKey`, then the name, then `trailing`.
- **Button name.** The button's accessible name is "<key> <name>", because the dot is `aria-hidden`.

### 4.3 Changed internal props

- `WorkItemSearchList`. The `taskLeading?: (task: WorkItem) => ReactNode` prop is replaced by `taskStateColor?: (task: WorkItem) => string`. Task rows pass `stateColor={taskStateColor?.(t)}`, so there is no dot when the callback is absent. Module rows never pass `stateColor`. Every other prop is unchanged. The only external caller of `taskLeading` is `BlockerPicker.tsx:49`.
- `WorkItemRowLabel`. Changes from `{ identifier: string; stateColor: string | null; name: string }` to `{ sequenceId: number | null; stateColor: string | null; name: string }`. When `sequenceId != null` it renders `WorkItemKey variant="inline"` followed by the existing muted " · " span. Otherwise it renders the name alone.
- `PlanningRowViewProps.identifier: string` is renamed to `sequenceId: number | null` and forwarded unchanged to `WorkItemRowLabel`.

## 5. File and component change map

All paths are relative to `studio/src`.

| # | Path | Action | Change | Local verification |
| --- | --- | --- | --- | --- |
| F1 | `features/work-items/WorkItemKey.tsx` | create | 4.1. Imports `./displayIdentifier` | F2 |
| F2 | `features/work-items/WorkItemKey.test.tsx` | create | `sequenceId={7}` renders "T-7". `null` with `inline` renders nothing. `null` with `cell` renders no "T-" text. `stateColor="#5b8def"` gives that style colour, and without it there is no inline colour. The span carries `data-task-id-token` | vitest |
| F3 | `features/work-items/WorkItemListRow.tsx` | create | 4.2. Imports `./WorkItemKey` and `../../shared/ui/StatusDot` | F4 |
| F4 | `features/work-items/WorkItemListRow.test.tsx` | create | With `onClick`, the button named `/T-7 Alpha/` calls the handler. `trailing` renders outside that button, and clicking a trailing button does not call `onClick`. `selected` sets `aria-current="true"`. Without `onClick` there is no button role. `variant="option"` renders the key and name and no button. The key formatting fallback gives no "T-null" | vitest |
| F5 | `features/work-items/index.ts` | modify | Add `export { WorkItemKey } from "./WorkItemKey";` and `export { WorkItemListRow } from "./WorkItemListRow";` next to the existing `WorkItemSearchList` export | typecheck |
| F6 | `features/work-items/WorkItemSearchList.tsx` | modify | Delete `Identifier`. Replace `taskLeading` with `taskStateColor` (4.3). Each module option becomes `PopoverOption` containing `WorkItemListRow variant="option" sequenceId={m.sequence_id} name={m.name}`. Each task option becomes `PopoverOption` containing `WorkItemListRow variant="option" sequenceId={t.sequence_id} name={t.name} stateColor={taskStateColor?.(t)}`. Drop the `formatWorkItemDisplayIdentifier` import; keep `ReactNode` (still used by `GroupHeading`) | `WorkItemSearchList.test.tsx` unchanged, `overhaulReparentConvergenceAcceptance` |
| F7 | `app/shell/ticket-workspace/selected-ticket/details/fields/BlockerPicker.tsx` | modify | Replace `taskLeading` with `taskStateColor={(c) => stateColor(stateById(states, c.state))}`. Drop the `StatusDot` import | `overhaulTaskWorkspaceIdentifierAcceptance` |
| F8 | `app/shell/ticket-workspace/selected-ticket/details/ChildIssues.tsx` | modify | Each child becomes `WorkItemListRow key={c.id} sequenceId={c.sequence_id} name={c.name} stateColor={stateColor(stateById(states, c.state))} onClick={() => void selectTask(c.id)}`. Drop the `formatWorkItemDisplayIdentifier` and `StatusDot` imports. The header, empty state and add-subtask form are unchanged | `overhaulTaskWorkspaceIdentifierAcceptance:111-115`, e2e `web-app.spec.ts:774,1757,4014-4037` |
| F9 | `app/shell/ticket-workspace/selected-ticket/details/FindingsPanel.tsx` | modify | Each finding becomes `WorkItemListRow key={f.id} data-testid="finding-row" sequenceId={f.sequence_id} name={f.name} onClick={() => void selectTask(f.id)}` with no `stateColor`. Its `trailing` holds, in order, `FindingLocationLabel issueId={f.id}`, then `Chip size="sm" dotColor={stateColor(state)} data-testid="finding-state"` showing `stateLabel(state)`, then the unchanged Cancel button. The inline-style pill is deleted. `formatWorkItemDisplayIdentifier` stays for the Cancel label. The `findings-queued-count` chip from ticket 11 is unchanged | `overhaulTaskWorkspaceIdentifierAcceptance:117-131`, e2e `web-app.spec.ts:1575-1600` |
| F10 | `app/shell/ticket-workspace/tasks/components/WorkItemRowLabel.tsx` | modify | Props and render as in 4.3, using `WorkItemKey` from `../../../../../features/work-items`. Update the doc comment from "identifier" to "sequence id" | `overhaulWorkItemRowAcceptance` unchanged |
| F11 | `app/shell/ticket-workspace/tasks/components/PlanningRowView.tsx` | modify | Rename `identifier: string` to `sequenceId: number \| null` in the props, the destructuring and the `WorkItemRowLabel` call (`:30`, `:51`, `:115`). Nothing else changes | Stories-pane suites |
| F12 | `app/shell/ticket-workspace/tasks/components/TaskRow.tsx` | modify | `:91` becomes `sequenceId={task.sequence_id}`. Remove the `formatWorkItemDisplayIdentifier` import (`:2`) | Stories-pane suites |
| F13 | `app/shell/ticket-workspace/tasks/components/ConversationRows.tsx` | modify | `:58` and `:132`: `identifier=""` becomes `sequenceId={null}`. The provider swatch is untouched (LLD 11, U1) | `overhaulWorkItemRowAcceptance:76-77`, `overhaulScratchAcceptance`, `overhaulInstantTicketsAcceptance` |
| U1 | `features/work-items/displayIdentifier.ts` | untouched | `formatWorkItemDisplayIdentifier` stays the single formatter and the public export | — |
| U2 | `app/shell/ticket-workspace/selected-ticket/details/Breadcrumb.tsx`, `IssueDetail.tsx`, `fields/ParentPicker.tsx`, `BlockerChipView.tsx` | untouched | 2.3 | — |
| U3 | `shared/ui/Popover.tsx` (`PopoverOption`) | untouched | Ticket 07 owns it | — |

## 6. Runtime semantics and failure handling

These components render only and have no I/O.

- **Missing sequence id.** `WorkItemKey` produces an empty string, never "T-null". The tree label then shows the name only, and a list row keeps an empty key column.
- **Missing state.** `stateById` returns null for an unknown state id. `stateColor(null)` returns the backlog group colour and `stateLabel(null)` returns "No state", so both the dot and the chip still render. This matches today.
- **Selection is unchanged.** A click selects the work item through `useClientStore.selectTask` exactly as before. Trailing controls sit outside the select button, so Cancel never also selects. The old markup already behaved this way, because Cancel was a sibling of the select button.

## 7. Ordered implementation plan

| Step | Files | Result | Depends on | Gate |
| --- | --- | --- | --- | --- |
| S1 | F1, F2, F3, F4, F5 | Both components exist, are tested and are exported | P-1, P-2 | `npx vitest run src/features/work-items/WorkItemKey.test.tsx src/features/work-items/WorkItemListRow.test.tsx` |
| S2 | F6, F7 | The search list uses `WorkItemListRow`, and `Identifier` and `taskLeading` are gone | S1 | `rg "function Identifier\|taskLeading" studio/src` is empty. `WorkItemSearchList.test.tsx` passes |
| S3 | F8, F9 | Child issues and findings use `WorkItemListRow`, and findings use the square state chip | S1 | `rg "w-20 flex-none font-mono" studio/src` matches only `WorkItemKey.tsx`. Identifier acceptance passes |
| S4 | F10, F11, F12, F13 | The tree label renders through `WorkItemKey` | S1 | Stories-pane suites (8.2) pass unchanged |
| S5 | all | Full gates | S1-S4 | `npm run typecheck`, `npm run test --workspace @worktracker/studio`, `npm run test:overhaul` |

## 8. Verification

### 8.1 New tests (vitest and @testing-library/react, colocated)

F2 and F4. They assert roles, accessible names, text, `aria-current`, inline colour and the `data-task-id-token` hook. They assert no class strings.

### 8.2 Existing guarding tests (must pass unchanged)

- **Stories tree.** `src/test/overhaulWorkItemRowAcceptance.test.tsx`, `overhaulDescriptionSelectionAcceptance.test.tsx`, `overhaulStoryReorderAcceptance.test.tsx`, `overhaulEditViewNavigationAcceptance.test.tsx`, `overhaulModuleTreeSubscriptionAcceptance.test.tsx`, `overhaulZeroProviderPlanningAcceptance.test.tsx`, `overhaulScratchAcceptance.test.tsx` and `overhaulInstantTicketsAcceptance.test.tsx`.
- **Detail pane.** `src/test/overhaulTaskWorkspaceIdentifierAcceptance.test.tsx`, `overhaulWorkItemAcceptance.test.tsx` and `overhaulReparentConvergenceAcceptance.test.tsx`.
- **Feature.** `src/features/work-items/WorkItemSearchList.test.tsx`.
- **Playwright.** Not a ticket gate, but it must not regress: `e2e/web-app.spec.ts:774`, `:1575-1600`, `:1757`, `:2142-2147` (the tree key colour via `getByText("T-<n>")`) and `:4014-4037`.

### 8.3 Manual check

Run `npm run web` and check:

- **Story detail.** The child issues show the dot, the key column and the name, and a click selects the child.
- **Story in Review.** The findings show the key, name, location, "■ Implement" and Cancel.
- **Blocker and Parent pickers.** Each shows the key column, and the blocker picker shows state dots.
- **Stories tree.** It still shows "T-n · name" with the key in the state colour.

## 9. Acceptance mapping

| ID | Ticket criterion | Steps | Signal |
| --- | --- | --- | --- |
| AC-1 | Both components are exported from `features/work-items/index.ts`, with tests for the key formatting fallback, the trailing slot and the selected state | S1 | F2 and F4 pass. F5 exports exist |
| AC-2 | ChildIssues, FindingsPanel and WorkItemSearchList use `WorkItemListRow`, and the private `Identifier` is deleted | S2, S3 | The S2 and S3 searches pass, and each of the three files imports `WorkItemListRow` |
| AC-3 | `WorkItemRowLabel` renders its key via `WorkItemKey`, and the Stories-pane tests pass unchanged | S4 | F10 imports `WorkItemKey`, and the 8.2 Stories-tree suites pass without edits |
| AC-4 | Typecheck, the studio tests and `test:overhaul` pass | S5 | All three commands exit 0 |
| AC-5 | The square state chip is the single state style, replacing the tinted pill | S3 | `FindingsPanel.tsx` has no inline `style` attribute, and `finding-state` is a `Chip` with `dotColor` |

## 10. Decisions

- D-1. Both components sit at the root of `features/work-items/`, beside the other display components, and are named exports through `index.ts`.
- D-2. `WorkItemKey` takes `sequenceId` and does the formatting itself. It has no fallback-text prop. `cell` keeps an empty column, and `inline` renders nothing.
- D-3. `WorkItemKey` always carries `data-task-id-token` as the key's hook.
- D-4. `WorkItemListRow` has a closed `variant` of `list` or `option`. `option` exists so the search list can stay on `PopoverOption`, which ticket 07 owns, without nesting buttons.
- D-5. Trailing content is always outside the select button. As a result, `FindingLocationLabel` leaves the finding button's accessible name.
- D-6. The tree-label input becomes `sequenceId` along `PlanningRowView`, `TaskRow` and `ConversationRows`. This is a prop rename only; the row is not rewritten.
- D-7. The finding state is `Chip size="sm"` with `dotColor` and the neutral tone. Findings rows pass no `stateColor`, so the state square appears once.

No user decision is open.
