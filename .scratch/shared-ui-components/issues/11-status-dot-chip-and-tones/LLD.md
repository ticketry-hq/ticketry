# LLD 11: StatusDot, Chip and one status tone map

| Field | Value |
| --- | --- |
| Work item | `issues/11-status-dot-chip-and-tones.md` |
| Parent | `.scratch/shared-ui-components/spec.md` (Story: Shared UI component library for Studio) |
| Module | Ticketry Studio frontend, `studio/src` |
| Blocked by | Nothing |
| Unblocks | Ticket 12 (`WorkItemKey`, `WorkItemListRow`), which uses `StatusDot` and `Chip` |
| Baseline | `main` at `a2541323`. Line numbers below were verified against it |
| Status | Ready to implement. No user decision is open |

## 1. Design basis

The spec and the ticket are authoritative. Where the ticket and the repository disagree, this LLD follows the repository and records why (section 3.2). The governing rules come from the repository `CLAUDE.md`: small single-purpose files, `shared/` for code used across features, theme tokens instead of hex, and a closed `variant`/`size` API with `className` used for layout only.

This LLD delivers:

- `StatusDot`. One size. Its colour comes from a status tone or from a workflow-state colour.
- `Chip`. A bordered mono chip with an optional leading dot. It has a removable form, a count variant, a clickable form and a `badge` size for lifecycle chicklets.
- One tone-to-token map, owned by `shared/ui/statusTone.ts`.
- One pull-request-state-to-tone map, owned by the worktrees feature and exported from `features/agents/worktrees/index.ts`.
- One shared renderer for the three identical lifecycle chip groups.

It does not replace any earlier LLD.

## 2. Scope and invariants

### 2.1 In scope

- Create `StatusDot`, `Chip` and `statusTone` in `studio/src/shared/ui/`, each with a colocated test where it has behaviour.
- Migrate every state-colour dot and tone dot in section 3.1 to `StatusDot`, except the cases listed in 2.3.
- Delete the private `Dot` components in `StatePicker.tsx` and `WorkflowStatePicker.tsx`.
- Collapse the worktrees tone maps (`toneClass`, `TONE_CLASS`/`checkoutToneClass`, the `InspectorSection` dot ternary, the `WorktreeBlock` class ternary and `BranchInspector`'s `pullRequestTone`) into two pieces: the shared tone-to-token map, and one exported pull-request tone map.
- Migrate the bordered mono chips, the tiny lifecycle badges, the removable chips and the count bubbles to `Chip`.
- Extract `LifecycleChipList`, which the three lifecycle chip groups will share.

### 2.2 Invariants (must not change)

- Every existing `data-testid` and `data-*` hook on a migrated element keeps its name, its value and the element it sits on. The full list is in section 4.6.
- Every accessible name stays the same: `Working tree state`, `Pull request state`, `Remove skill "<name>"`, `Remove blocker`, `Retry failed automated launch`, the Claude trust and startup reasons, `Dormant tabs (N)` and `Choose checkout`.
- The state picker trigger keeps its workflow-state colour as an inline `style.backgroundColor` on the first `span` inside `[data-testid="state-picker"]`. `e2e/web-app.spec.ts:2147` reads that computed style.
- `LifecycleBadge` keeps the class tokens its tests read on the chip root (`text-lifecycle-attention`, `text-lifecycle-idle`, `text-lifecycle-success`, `text-provider-claude`, `text-provider-codex`). It also keeps `aria-label`/`title` on that root, `.animate-spin` on the reconnecting glyph, and its null render for `unknown`.
- `stateColor` and `stateLabel` in `shared/utilities/display.ts` remain the only source of workflow-state colour and label.
- No screen gains or loses behaviour. Only colours and sizes listed in section 2.4 change.

### 2.3 Out of scope and hand-offs

| Item | Owner | Reason |
| --- | --- | --- |
| `features/module-tabs/ModuleJumpBadge.tsx:13` | Ticket 02 | Ticket 02 moves it onto `KeyBadge`. This ticket leaves the file untouched. |
| `app/shell/ticket-workspace/tasks/components/ConversationRows.tsx:73-80` provider swatch | Untouched | It encodes provider identity and liveness through `providerToneClasses` (border plus fill). It is not a status. `tailwind.config.ts` explicitly keeps the provider palette separate from the lifecycle axis. |
| `details/FindingsPanel.tsx:71-77` tinted state pill | Ticket 12 | The user chose the square state chip as the single state style. Ticket 12 makes that change when it moves the finding row onto `WorkItemListRow`. |
| The "×" glyph inside `Chip`'s remove control | Ticket 01 (`CloseButton`) | See D-6. Whichever ticket lands second converts the one site inside `Chip.tsx`. |
| The trigger text, the menu and the "▾" of `DormantWorkspaceTabs` | Tickets 07 and 08 | This ticket replaces only the count bubble at `:163-165`. |
| The `WorktreeSwitcher` listbox | Ticket 08 | This ticket replaces only the two dots at `:119` and `:149`. |
| The `FindingsPanel` Cancel button and the `TransitionDisclosure` toggle | Ticket 05 (`Button`) | No change here. |
| New Tailwind tokens | Not needed | Every colour maps to an existing token (`lifecycle-*`, `text-*`, `pane-*`, `provider-*`). `text-[10px]` is a size, not a colour, and stays an arbitrary value inside `Chip`. |

### 2.4 Deliberate visible changes

Story 20 asks that one status always shows one colour. These changes follow from that. They are intended, and no existing automated assertion covers them.

| Surface | Status | Before | After |
| --- | --- | --- | --- |
| `ChangesStateChips` pull-request dot | `ready`, `merged` | muted | success |
| `ChangesStateChips` pull-request dot | `checks_pending`, `mergeability_pending` | danger | active |
| `ChangesStateChips` pull-request dot | `approval_required`, `unavailable`, unknown | danger | attention |
| `ChangesStateChips` pull-request dot | `closed_unmerged` | danger | muted |
| `BranchInspector` pull-request chip dot | `checks_pending`, `mergeability_pending` | attention | active |
| `BranchInspector` pull-request chip dot | `closed_unmerged` | attention | muted |
| `LifecycleBadge` active state when the agent has no provider hue | — | `text-text-primary` | `text-lifecycle-active` |
| `AutomationFailureChicklet` | failed | off-token `red-500`/`red-600` with a tint | `lifecycle-danger`, no tint |
| `BlockerChipView` | unresolved blocker | attention with a 10% tint | attention outline, no tint |
| `BlockerChipView` remove control | — | shown on hover or focus only | always shown |
| State and tone dots | — | `size-2.5` (pickers, issue types) and `size-1.5` (app update) | `size-2` everywhere |
| `AutomationDeliveryChicklet` | — | `font-medium` on `bg-pane-panel` | badge style: `font-bold` on `bg-pane-bg` |
| `StageSkillsField` chips | — | `text-sm`, "×" glyph | `text-xs` (`md` chip), `IconX` |
| `DormantWorkspaceTabs` count bubble | — | `text-text-primary` | count chip: `text-text-secondary`, `font-bold` |

## 3. Repository findings and preflight

### 3.1 Verified instances (paths relative to `studio/src`)

| Ticket reference | Verified location | What is there | Disposition |
| --- | --- | --- | --- |
| `details/ChildIssues.tsx:51` | `app/shell/ticket-workspace/selected-ticket/details/ChildIssues.tsx:50-53` | `h-2 w-2` span with inline `stateColor` | `StatusDot color` |
| `fields/BlockerPicker.tsx:51` | `.../details/fields/BlockerPicker.tsx:49-54` | `taskLeading` span with inline `stateColor` | `StatusDot color` |
| `fields/StatePicker.tsx:21` | `.../details/fields/StatePicker.tsx:21-28`, used at `:55` and `:80` | private `Dot` (`h-2.5 w-2.5`) | Delete it and use `StatusDot color` |
| `WorkflowStatePicker.tsx:36` | `.../details/WorkflowStatePicker.tsx:36-38`, used at `:76, :94, :103, :114, :123` | private `Dot` | Delete it and use `StatusDot color` |
| `IssueTypesSection.tsx:295` | `features/workflows/IssueTypesSection.tsx:293-297` | `size-2.5` span, `state.color ?? "#7a8599"` (hex) | `StatusDot color={state.color}`, falling back to the `muted` tone (`bg-text-muted` = `#7a8599`) |
| `FindingsPanel.tsx:74` | `.../details/FindingsPanel.tsx:71-77` | tinted pill | Ticket 12 |
| `WorktreeBlock.tsx:333` and `:238` | `features/agents/worktrees/WorktreeBlock.tsx:238-244` (class ternary), `:333` (dot) | ternary returning `bg-*` classes | The ternary returns `StatusTone` names, and `StatusDot tone` renders the dot |
| `ChangesStateChips.tsx:3,37,46` and chips `:34,43` | `features/agents/worktrees/changes/ChangesStateChips.tsx:3-7` (`toneClass`), `:33-49` | two bordered chips with tone dots | Delete `toneClass`. Use `Chip dotTone` with `pullRequestTone` |
| `InspectorSection.tsx:56` and chip `:55` | `features/agents/worktrees/changes/InspectorSection.tsx:31-37` (a fifth tone ternary the ticket did not list), `:54-59` | bordered chip with tone dot | Delete the ternary. Use `Chip size="sm" dotTone` |
| `WorktreeSwitcher.tsx:119,149` | `features/agents/worktrees/changes/WorktreeSwitcher.tsx:9` (import), `:119`, `:149` | `checkoutToneClass` dots | `StatusDot tone` |
| `worktreeCheckoutRows.ts:22` | `features/agents/worktrees/changes/worktreeCheckoutRows.ts:11` (`CheckoutTone`), `:22-32` (`TONE_CLASS`, `checkoutToneClass`), `:34-44` (`PULL_REQUEST_TONE`) | tone type, tone-to-class map, pull-request-to-tone-plus-summary map | Delete the first three. Split the fourth into tone (moved) and summary (kept) |
| `BranchInspector.tsx:236` | `features/agents/worktrees/changes/BranchInspector.tsx:236-241`, used at `:163` | `pullRequestTone`, which disagrees with `PULL_REQUEST_TONE` | Delete it and import the shared one |
| `ConversationRows.tsx:76` | `app/shell/ticket-workspace/tasks/components/ConversationRows.tsx:73-80` | provider swatch | Untouched (2.3) |
| `AppUpdateAvailabilityIndicator.tsx:25` | `features/app-updates/AppUpdateAvailabilityIndicator.tsx:22-26` | `size-1.5 bg-lifecycle-attention` | `StatusDot tone="attention" title="Update available"` |
| `TransitionDisclosure.tsx:56` | `features/workflows/TransitionDisclosure.tsx:56-58` | bordered muted chip, no dot | `Chip size="sm" tone="muted"` |
| `LifecycleBadge.tsx:70` | `features/agents/terminal/LifecycleBadge.tsx:14-31` (two class maps), `:68-79` | tiny tone badge | `Chip size="badge"`. Delete both maps |
| `AutomationDeliveryChicklet.tsx:34` | `features/agents/lifecycle/AutomationDeliveryChicklet.tsx:32-42` | tiny muted badge | `Chip size="badge" tone="muted"` |
| `AutomationFailureChicklet.tsx:48` | `features/agents/lifecycle/AutomationFailureChicklet.tsx:46-70` | tiny badge with off-token reds and an inner retry button | `Chip size="badge" tone="danger"`. The retry button stays a child |
| `ClaudeStartupAttentionAction.tsx:47` | `features/agents/lifecycle/ClaudeStartupAttentionAction.tsx:42-56` | tiny attention badge rendered as a button | `Chip size="badge" tone="attention" onClick` |
| `ModuleJumpBadge.tsx:13` | `features/module-tabs/ModuleJumpBadge.tsx:9-16` | key badge | Ticket 02 |
| `BlockerChipView.tsx:28-50` | `app/shell/ticket-workspace/selected-ticket/details/BlockerChipView.tsx:25-56` | removable chip, uses `quietChipRemoveClassName` | `Chip` removable |
| `StageSkillsField.tsx:35-45` | `features/workflows/StageSkillsField.tsx:32-45` | removable chip | `Chip` removable |
| `DormantWorkspaceTabs.tsx:163` | `app/shell/ticket-workspace/selected-ticket/internal/DormantWorkspaceTabs.tsx:163-165` | count bubble | `Chip variant="count" size="badge"` |
| `FindingsPanel.tsx:45` | `.../details/FindingsPanel.tsx:43-48` | "N fixes queued" pill | `Chip variant="count" size="sm"` |
| Chip groups | `features/agents/status/ModuleLifecycleChicklets.tsx:10-19`, `features/agents/lifecycle/AgentStateBadge.tsx:33-42`, `ScratchStateBadge.tsx:46-55` | the same `chips.map(LifecycleBadge …)` body | `LifecycleChipList` |

A repository-wide search for `backgroundColor` and for the dot size classes (`size-2`, `size-1.5`, `size-2.5`, `h-2 w-2`, `h-2.5 w-2.5`) found nothing beyond this table, other than the conversations prototype, which is not a gate.

### 3.2 Ticket-versus-repository conflicts, resolved

- **Where the "one mapping" lives.** The ticket says the single status colour mapping is "exported from the worktrees feature". `StatusDot` and `Chip` live in `shared/`, and `shared/` must not import a feature, so the tone-to-token half of the mapping cannot live in worktrees. The design therefore splits it:
  - the tone-to-token map is owned by `shared/ui/statusTone.ts`;
  - the status-to-tone map (pull-request state to tone) is owned and exported by the worktrees feature.

  The result is still one colour per tone and one tone per pull-request state. The four overlapping worktrees maps are all deleted.
- **InspectorSection.** `InspectorSection.tsx:31-37` holds a further tone-to-class ternary that the ticket did not list. It is deleted in the same way.

### 3.3 Preflight gates

- P-1. Run `npm run typecheck`, `npm run test --workspace @worktracker/studio` and `npm run test:overhaul` (from `studio/`) on the baseline. All three must pass. If the baseline is red, stop and report; do not mix fixes into this ticket.
- P-2. Check whether `studio/src/shared/ui/CloseButton.tsx` (ticket 01) exists. The answer selects the branch in D-6.
- P-3. If ticket 02 has not landed, leave `ModuleJumpBadge.tsx` alone anyway.

## 4. Contracts

### 4.1 Tone vocabulary and token map: `shared/ui/statusTone.ts` (owner)

Exported types:

- `StatusTone` = `"active" | "attention" | "danger" | "idle" | "success" | "muted"`
- `ProviderTone` = `"claude" | "codex" | "gemini" | "agy"`. This equals `TerminalProvider`, but it is redeclared here so that `shared/` does not import from a feature.
- `ChipTone` = `StatusTone | "neutral" | ProviderTone`

Exported constants hold literal class strings. Tailwind's scanner only emits classes it finds written out in full, so no string may be built by interpolation.

| Key | `STATUS_DOT_CLASS` (fill) | `CHIP_TONE_CLASS` (outline border and text) |
| --- | --- | --- |
| `active` | `bg-lifecycle-active` | `border-lifecycle-active/70 text-lifecycle-active` |
| `attention` | `bg-lifecycle-attention` | `border-lifecycle-attention/70 text-lifecycle-attention` |
| `danger` | `bg-lifecycle-danger` | `border-lifecycle-danger/70 text-lifecycle-danger` |
| `idle` | `bg-lifecycle-idle` | `border-lifecycle-idle/70 text-lifecycle-idle` |
| `success` | `bg-lifecycle-success` | `border-lifecycle-success/70 text-lifecycle-success` |
| `muted` | `bg-text-muted` | `border-pane-border text-text-muted` |
| `neutral` | not a dot tone | `border-pane-border text-text-secondary` |
| `claude` | not a dot tone | `border-provider-claude/60 text-provider-claude` |
| `codex` | not a dot tone | `border-provider-codex/60 text-provider-codex` |
| `gemini` | not a dot tone | `border-provider-gemini/60 text-provider-gemini` |
| `agy` | not a dot tone | `border-provider-agy/60 text-provider-agy` |

`STATUS_DOT_CLASS` is typed `Record<StatusTone, string>` and `CHIP_TONE_CLASS` is typed `Record<ChipTone, string>`, so adding a tone is a compile error until both maps carry it. Only `StatusDot.tsx` and `Chip.tsx` read these constants. Other code imports only the types.

### 4.2 `StatusDot`: `shared/ui/StatusDot.tsx` (default export `StatusDot`)

| Prop | Type | Default | Behaviour |
| --- | --- | --- | --- |
| `tone` | `StatusTone` | `"muted"` | Sets the fill from `STATUS_DOT_CLASS[tone]` |
| `color` | `string \| null \| undefined` | — | When truthy, renders as inline `style.backgroundColor` and the tone class is left off. Used for workflow-state colours from `stateColor(state)` or `state.color` |
| `title` | `string` | — | Forwarded |
| `className` | `string` | — | Layout only (for example `mt-1.5`, `ml-auto`). Never colour or size |

It renders one `<span aria-hidden="true">` with classes `inline-block size-2 shrink-0` plus the tone class. The span is always decorative: the meaning travels in adjacent text or in an `aria-label` on the parent. It never renders text.

### 4.3 `Chip`: `shared/ui/Chip.tsx` (default export `Chip`)

| Prop | Type | Default | Behaviour |
| --- | --- | --- | --- |
| `children` | `ReactNode` | required | The label |
| `variant` | `"outline" \| "count"` | `"outline"` | `outline` is a bordered chip in `tone`. `count` is a borderless filled count pill (`border-transparent bg-pane-title text-text-secondary`) and ignores `tone`. The type allows `tone`, `onRemove` and `onClick` only when `variant` is `"outline"` |
| `tone` | `ChipTone` | `"neutral"` | Border and text colour from `CHIP_TONE_CLASS` |
| `size` | `"md" \| "sm" \| "badge"` | `"md"` | `md`: `gap-2 px-2 py-1 text-xs font-normal`. `sm`: `gap-1.5 px-1.5 py-0.5 text-xs font-normal`. `badge`: `gap-1 px-1 text-[10px] font-bold leading-4`, plus `bg-pane-bg` for outline |
| `dotTone` | `StatusTone` | — | Renders a leading `StatusDot tone` |
| `dotColor` | `string \| null` | — | Renders a leading `StatusDot color`. Takes precedence over `dotTone` |
| `onClick` | `(event: MouseEvent<HTMLButtonElement>) => void` | — | When present, the root is a `<button type="button">` that adds `hover:bg-pane-title disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-accent`. Cannot be combined with `onRemove` (enforced by the type) |
| `onRemove` | `() => void` | — | Removable form. Appends one remove control after `children` |
| `removeLabel` | `string` | required when `onRemove` is set | The remove control's `aria-label` |
| `removeTestId` | `string` | — | The remove control's `data-testid` |
| `disabled` | `boolean` | `false` | Disables the remove control, or the root when `onClick` is set |
| `title`, `aria-label` | `string` | — | Forwarded to the root |
| `data-*` | `string \| undefined` | — | Forwarded to the root through a `` `data-${string}` `` index signature, for `data-testid`, `data-warn`, `data-delivery-mode` and similar |
| `className` | `string` | — | Layout only |

Every root also carries `inline-flex shrink-0 items-center border font-mono`. Without `onClick` the root is a `<span>`, and `children` may contain interactive elements: the blocker select button and the failure retry button. The remove control is a `<button type="button">` with classes `inline-flex text-text-muted hover:text-lifecycle-danger disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-accent`. Its content is described in D-6. The root renders no text other than `children` and the remove control.

### 4.4 Pull-request tone: `features/agents/worktrees/changes/pullRequestTone.ts` (owner)

- `PULL_REQUEST_TONE: Readonly<Record<string, StatusTone>>`, with these values:

  | State | Tone |
  | --- | --- |
  | `ready`, `merged` | `success` |
  | `merge_conflict`, `checks_failed`, `wrong_base` | `danger` |
  | `checks_pending`, `mergeability_pending` | `active` |
  | `approval_required` | `attention` |
  | `closed_unmerged` | `muted` |

  This is the superset taken from `worktreeCheckoutRows.ts:34-44`.
- `pullRequestTone(state?: string | null): StatusTone` returns:
  - `muted` for `null`, `undefined` or `"none"`;
  - `PULL_REQUEST_TONE[state]` when the state is a key;
  - `attention` otherwise (this covers `"unavailable"` and future states).
- Both are re-exported from `features/agents/worktrees/index.ts`. They are the feature's single public status-tone mapping.

`worktreeCheckoutRows.ts` keeps its summary text in a renamed private record, `PULL_REQUEST_SUMMARY: Record<string, string>`, with the same keys and the same strings ("PR ready", "PR conflicts", "checks failed", "checks running", "approval required", "mergeability pending", "wrong base", "merged", "PR closed"). `withCheckoutStatus` returns `{ summary: PULL_REQUEST_SUMMARY[state], tone: pullRequestTone(state) }` only when a summary exists. Its precedence (unavailable, then pull request, then local, then clean) and all its outputs stay the same. `WorktreeCheckoutRow.tone` becomes `StatusTone`.

### 4.5 `LifecycleChipList`: `features/agents/status/LifecycleChipList.tsx` (named export)

Props: `chips: readonly TaskLifecycleChip[]`. It renders a fragment of `LifecycleBadge`, one per chip, with key `` `${chip.state}|${chip.agent ?? ""}` ``, `state`, `agent`, `count`, `showLabel={false}` and `alwaysShowCount`. It renders no wrapper. Each caller keeps its own wrapper `span`, `data-testid`, `data-state` and trailing `ClaudeStartupAttentionAction`.

### 4.6 Preserved hooks

`data-testid="automation-delivery-chicklet"` and `data-delivery-mode`, `data-testid="automation-failure-chicklet"`, `data-testid="blocker-chip"` and `data-warn`, `data-testid="remove-blocker"` (via `removeTestId`), `data-testid="findings-queued-count"`, `data-testid="dormant-tabs-trigger"` (on the unchanged trigger button), `data-testid="agent-state-badge"` and `data-state`, `data-testid="scratch-run-chicklets"` and `data-state`, `data-testid="state-picker"` (unchanged, on `Popover`), and `data-testid="changes-worktree-switcher"` (unchanged).

## 5. File and component change map

All paths are relative to `studio/src`.

| # | Path | Action | Change | Local verification |
| --- | --- | --- | --- | --- |
| F1 | `shared/ui/statusTone.ts` | create | `StatusTone`, `ProviderTone`, `ChipTone`, `STATUS_DOT_CLASS`, `CHIP_TONE_CLASS` (4.1). No React | typecheck |
| F2 | `shared/ui/StatusDot.tsx` | create | 4.2 | F3 |
| F3 | `shared/ui/StatusDot.test.tsx` | create | It is `aria-hidden` and has no text. `color` sets `style.backgroundColor`. `title` is forwarded | vitest |
| F4 | `shared/ui/Chip.tsx` | create | 4.3. Imports F1 and F2 | F5 |
| F5 | `shared/ui/Chip.test.tsx` | create | Removable: the button is named by `removeLabel`, a click calls `onRemove`, and `disabled` blocks it. Count: children text is rendered. `onClick`: the root has the button role with the forwarded `aria-label` and fires. `aria-label` and `data-testid` are forwarded on the span root. A dot is decorative (it adds no text). No class-string assertions | vitest |
| F6 | `features/agents/worktrees/changes/pullRequestTone.ts` | create | 4.4 | F7 |
| F7 | `features/agents/worktrees/changes/pullRequestTone.test.ts` | create | Table-driven: every key gives its tone, `null`/`"none"` give `muted`, and `"unavailable"`/`"surprise"` give `attention` | vitest |
| F8 | `features/agents/worktrees/index.ts` | modify | Add `export { PULL_REQUEST_TONE, pullRequestTone } from "./changes/pullRequestTone";` | typecheck |
| F9 | `features/agents/worktrees/changes/worktreeCheckoutRows.ts` | modify | Delete `CheckoutTone`, `TONE_CLASS` and `checkoutToneClass`. Rename `PULL_REQUEST_TONE` to the private `PULL_REQUEST_SUMMARY` (summaries only). Set `tone: StatusTone`. `withCheckoutStatus` uses `pullRequestTone` (4.4) | switcher acceptance suites |
| F10 | `features/agents/worktrees/changes/WorktreeSwitcher.tsx` | modify | Replace the `checkoutToneClass` import and the spans at `:119` and `:149` with `StatusDot tone={…tone}`. The option dot keeps `className="mt-1.5"` | `overhaulWorktreeSwitcherFailureAcceptance`, `overhaulChangesWorkspaceNavigationAcceptance` |
| F11 | `features/agents/worktrees/changes/ChangesStateChips.tsx` | modify | Delete `toneClass`. Working tree: `Chip aria-label="Working tree state" dotTone={local.length > 0 ? "attention" : "muted"}`. Pull request: `Chip aria-label="Pull request state" title={pullRequest?.reason ?? undefined} dotTone={pullRequestTone(pullRequest?.state)}` | `overhaulModuleVersionControlAcceptance:223`, `overhaulTaskWorktreeChangesAcceptance:880-885` |
| F12 | `features/agents/worktrees/changes/InspectorSection.tsx` | modify | Delete the `dot` ternary. Change `chipTone` to type `StatusTone` (default `"muted"`). Render `Chip size="sm" dotTone={chipTone} className="ml-auto"` | `overhaulChangesBranchKeyboardAcceptance` |
| F13 | `features/agents/worktrees/changes/BranchInspector.tsx` | modify | Delete the local `pullRequestTone` (`:236-241`) and import it from `./pullRequestTone`. `pullRequestChip` is unchanged | same as F12 |
| F14 | `features/agents/worktrees/WorktreeBlock.tsx` | modify | The `:238` ternary yields the `StatusTone` values `muted`, `danger`, `attention` and `success`. `:333` becomes `StatusDot tone={tone}` | `overhaulSelectedTaskWorktreeAcceptance`, `overhaulWorktreeCleanupAcceptance` |
| F15 | `app/shell/ticket-workspace/selected-ticket/details/fields/StatePicker.tsx` | modify | Delete `Dot`. Use `StatusDot color={stateColor(…)}` at `:55` (the trigger icon, which stays the first span) and `:80` | `overhaulTransitionLandingAcceptance`, `overhaulRunNowAcceptance`, e2e `web-app.spec.ts:2147` |
| F16 | `app/shell/ticket-workspace/selected-ticket/details/WorkflowStatePicker.tsx` | modify | Delete `Dot`. Use `StatusDot color={stateColor(state)}` at all five sites | same as F15 |
| F17 | `app/shell/ticket-workspace/selected-ticket/details/fields/BlockerPicker.tsx` | modify | `taskLeading` returns `StatusDot color={stateColor(stateById(states, c.state))}` | `overhaulTaskWorkspaceIdentifierAcceptance` |
| F18 | `app/shell/ticket-workspace/selected-ticket/details/ChildIssues.tsx` | modify | `:50-53` becomes `StatusDot color={stateColor(stateById(states, c.state))}`. Ticket 12 later moves the dot into `WorkItemListRow` | same as F17 |
| F19 | `features/workflows/IssueTypesSection.tsx` | modify | `:293-297` becomes `StatusDot color={state.color}`. The `#7a8599` literal goes; the fallback is the `muted` tone | workflow settings suites |
| F20 | `features/app-updates/AppUpdateAvailabilityIndicator.tsx` | modify | `:22-26` becomes `StatusDot tone="attention" title="Update available"`. The `sr-only` description is unchanged | `overhaulAppUpdatesAcceptance` |
| F21 | `features/workflows/TransitionDisclosure.tsx` | modify | `:56-58` becomes `Chip size="sm" tone="muted"` with the same text | `overhaulWorkflow*` suites |
| F22 | `features/agents/terminal/LifecycleBadge.tsx` | modify | Delete `TONE_CLASS` and `RUNNING_PROVIDER_CLASS`. Compute the `ChipTone`: `agent` when `p.tone === "active" && isTerminalProvider(agent)`, `muted` when `p.tone === "neutral"`, otherwise `p.tone`. Render `Chip size="badge" tone={…} title={p.title} aria-label={p.title}` with the same glyph, label and count children | `test/terminal/LifecycleBadge.test.tsx`, `LifecycleBadgeProvider.test.tsx` unchanged |
| F23 | `features/agents/lifecycle/AutomationDeliveryChicklet.tsx` | modify | `Chip size="badge" tone="muted" className={className} data-testid="automation-delivery-chicklet" data-delivery-mode={delivery.mode} title={…}` with the same children | `overhaulAutomationDeliveryAcceptance` |
| F24 | `features/agents/lifecycle/AutomationFailureChicklet.tsx` | modify | `Chip size="badge" tone="danger" className={className} data-testid="automation-failure-chicklet" title={…}`. The glyph `span` loses `px-1`. The retry button keeps its handler, label and disabled logic, with classes `border-l border-lifecycle-danger/40 pl-1 hover:bg-lifecycle-danger/15 disabled:cursor-wait`. No `red-*` classes remain | `overhaulStatusStreamConsumerAcceptance:432-465` |
| F25 | `features/agents/lifecycle/ClaudeStartupAttentionAction.tsx` | modify | `Chip size="badge" tone="attention" aria-label={reason} title={reason} onClick={…}`. The handler keeps `event.stopPropagation()` and the dispatch. Text stays "Open terminal" | `overhaulClaudeTrustAttentionAcceptance` |
| F26 | `features/agents/status/LifecycleChipList.tsx` | create | 4.5 | callers' suites |
| F27 | `features/agents/status/ModuleLifecycleChicklets.tsx` | modify | The body becomes `LifecycleChipList chips={chips}` inside the existing wrapper | `overhaulModule*` suites |
| F28 | `features/agents/lifecycle/AgentStateBadge.tsx` | modify | Same as F27. Keeps `data-testid` and `data-state` | `test/AgentStateBadge.test.tsx` |
| F29 | `features/agents/lifecycle/ScratchStateBadge.tsx` | modify | Same as F27 | `overhaulScratchAcceptance` |
| F30 | `app/shell/ticket-workspace/selected-ticket/details/BlockerChipView.tsx` | modify | `Chip size="sm" tone={warn ? "attention" : "neutral"} data-testid="blocker-chip" data-warn={…} title={…} onRemove={onRemove} removeLabel="Remove blocker" removeTestId="remove-blocker" disabled={disabled}`. The children are the existing select `button` (identifier text and `IconAlertTriangle`). Drop the `quietChipRemoveClassName` import | `overhaulTaskWorkspaceIdentifierAcceptance` (T-404/T-405), e2e `web-app.spec.ts:1700` |
| F31 | `app/shell/ticket-workspace/selected-ticket/details/fields/QuietChipControls.tsx` | modify | Delete `quietChipRemoveClassName`, which has no remaining caller. `GhostChipAdd` is unchanged | typecheck |
| F32 | `features/workflows/StageSkillsField.tsx` | modify | Each skill becomes `Chip key={skill} onRemove={…} removeLabel={`Remove skill "${skill}"`}` in the default `md` size. The inline "×" button is deleted | `overhaulWorkflowStageSkillsAcceptance`, `overhaulWorkflowStageSkillSerializationAcceptance` |
| F33 | `app/shell/ticket-workspace/selected-ticket/internal/DormantWorkspaceTabs.tsx` | modify | Only `:163-165` changes: `Chip variant="count" size="badge"` showing `{count}` | `overhaulDormantWorkspaceTabsAcceptance`, `test/dormantTabsFixture.ts` |
| F34 | `app/shell/ticket-workspace/selected-ticket/details/FindingsPanel.tsx` | modify | Only `:43-48` changes: `Chip variant="count" size="sm" data-testid="findings-queued-count"` with the same text. The state pill is ticket 12's | e2e `web-app.spec.ts:1580` ("1 fix queued") |
| U1 | `app/shell/ticket-workspace/tasks/components/ConversationRows.tsx` | untouched | Provider swatch (2.3) | — |
| U2 | `features/module-tabs/ModuleJumpBadge.tsx` | untouched | Ticket 02 | — |
| U3 | `shared/utilities/display.ts` | untouched | `stateColor`/`stateLabel` stay the workflow-state source | — |
| U4 | `tailwind.config.ts` | untouched | No new token is needed | — |
| U5 | `app/shell/ticket-workspace/selected-ticket/details/fields/PickerTrigger.tsx` | untouched | Still renders `icon` first, so `StatusDot` stays the first span | — |

## 6. Runtime semantics and failure handling

These components render only; they have no I/O, so no failure path depends on the network.

- An unknown or missing pull-request state gives the `attention` tone (4.4) and never a missing class.
- `StatusDot` with a falsy `color` falls back to `tone`, which defaults to `muted`. So a missing state colour still renders a visible muted square, as `IssueTypesSection` does today.
- Unrecognised tones cannot occur: `Record<…>` typing makes them compile errors.
- `Chip` without `onRemove` renders no remove control. A remove control always has an accessible name, because the type makes `removeLabel` required alongside `onRemove`.
- **Tailwind risk.** Classes assembled at runtime would silently produce no CSS. Every class in F1 and F4 must be a complete literal. Verify with `npm run build --workspace @worktracker/studio` and a visual check of one dot per tone (section 8.3).

## 7. Ordered implementation plan

| Step | Files | Result | Depends on | Gate |
| --- | --- | --- | --- | --- |
| S1 | F1, F2, F3, F4, F5 | The shared tone map and both components exist with tests | P-1, P-2 | `npx vitest run src/shared/ui` |
| S2 | F6, F7, F8, F9, F10, F11, F12, F13, F14 | Worktrees has one pull-request tone map, and the other maps and ternaries are deleted | S1 | `rg "checkoutToneClass\|CheckoutTone\|toneClass\(" studio/src` is empty. Worktree and changes acceptance suites pass |
| S3 | F15, F16, F17, F18, F19, F20 | The state and tone dots are migrated and the private `Dot`s deleted | S1 | `rg "function Dot\(" studio/src` is empty. The state-picker suites pass |
| S4 | F21, F22, F23, F24, F25, F26, F27, F28, F29 | The lifecycle badges sit on `Chip` and the chip groups share `LifecycleChipList` | S1 | The `LifecycleBadge*` tests pass unchanged. `rg "red-500\|red-600" studio/src/features/agents` is empty |
| S5 | F30, F31, F32, F33, F34 | The removable and count chips are migrated | S1 | Stage-skills, dormant-tabs and identifier suites pass. `rg quietChipRemoveClassName studio/src` is empty |
| S6 | all | Full gates | S1-S5 | `npm run typecheck`, `npm run test --workspace @worktracker/studio`, `npm run test:overhaul`, `npm run build --workspace @worktracker/studio` |

S2 to S5 are independent of each other once S1 lands.

## 8. Verification

### 8.1 New tests (vitest and @testing-library/react, colocated)

- `shared/ui/StatusDot.test.tsx` (F3) and `shared/ui/Chip.test.tsx` (F5). They assert roles, names, text, callbacks, the disabled state and inline style. They assert no class strings, as the spec requires.
- `features/agents/worktrees/changes/pullRequestTone.test.ts` (F7). A pure function table.

### 8.2 Existing guarding tests (must pass unchanged)

- `src/test/terminal/LifecycleBadge.test.tsx` and `src/test/terminal/LifecycleBadgeProvider.test.tsx`: tone tokens on the chip root.
- `src/test/AgentStateBadge.test.tsx`.
- `src/test/overhaulAutomationDeliveryAcceptance.test.tsx`, `overhaulStatusStreamConsumerAcceptance.test.tsx` and `overhaulClaudeTrustAttentionAcceptance.test.tsx`.
- `src/test/overhaulWorkflowStageSkillsAcceptance.test.tsx` and `overhaulWorkflowStageSkillSerializationAcceptance.test.tsx`.
- `src/test/overhaulModuleVersionControlAcceptance.test.tsx`, `overhaulTaskWorktreeChangesAcceptance.test.tsx`, `overhaulChangesBranchKeyboardAcceptance.test.tsx`, `overhaulChangesWorkspaceNavigationAcceptance.test.tsx`, `overhaulWorktreeSwitcherFailureAcceptance.test.tsx`, `overhaulStackedPullRequestAcceptance.test.tsx` and `overhaulWorktreeCleanupAcceptance.test.tsx`.
- `src/test/overhaulDormantWorkspaceTabsAcceptance.test.tsx` and `overhaulAppUpdatesAcceptance.test.tsx`.
- `src/test/overhaulTaskWorkspaceIdentifierAcceptance.test.tsx`, `overhaulTransitionLandingAcceptance.test.tsx`, `overhaulRunNowAcceptance.test.tsx` and `overhaulSelectedTaskWorktreeAcceptance.test.tsx`.
- `src/test/overhaulScratchAcceptance.test.tsx` and `overhaulInstantTicketsAcceptance.test.tsx`.
- Playwright (not a ticket gate, but it must not regress): `e2e/web-app.spec.ts:1580-1600` (queued count) and `:1700` (remove blocker), `:2147` (state-picker dot colour).

### 8.3 Manual check

Run `npm run web` and check:

- the issue detail state picker: the dot sits beside the label and matches the state colour;
- the blocker chips, both resolved and unresolved, with remove always visible;
- the Changes toolbar chips across the pull-request states in 2.4;
- a running Claude tab badge (orange) and a needs-input badge (amber);
- the Settings Workflows issue-type states.

## 9. Acceptance mapping

| ID | Ticket criterion | Steps | Signal |
| --- | --- | --- | --- |
| AC-1 | `shared/ui/StatusDot.tsx` and `shared/ui/Chip.tsx` exist with tests covering the removable chip's remove-button label and count rendering | S1 | F3 and F5 pass |
| AC-2 | The worktrees feature exports one status colour mapping, and the other three are deleted | S2 | F7 passes. `PULL_REQUEST_TONE`/`pullRequestTone` are exported from `features/agents/worktrees/index.ts`. The S2 search is empty, and `BranchInspector` and `InspectorSection` hold no tone logic |
| AC-3 | The private `Dot` components are deleted | S3 | The S3 search is empty |
| AC-4 | Typecheck, the studio tests and `test:overhaul` pass | S6 | All three commands exit 0, and the 8.2 suites need no edits |
| AC-5 | The three identical lifecycle chip-group bodies share one renderer | S4 | `LifecycleChipList` is imported by F27, F28 and F29, and none of them maps `LifecycleBadge` directly |
| AC-6 | Statuses keep one colour each and use theme tokens | S2, S4 | No `#7a8599`, `red-500` or `red-600` remains in the migrated files. The 2.4 changes are reviewed |

## 10. Decisions

- D-1. The tone-to-token map is owned by `shared/ui/statusTone.ts` and the pull-request-to-tone map by `features/agents/worktrees/changes/pullRequestTone.ts` (3.2).
- D-2. There is one dot size, `size-2`, and it is always square and decorative.
- D-3. `PULL_REQUEST_TONE` uses the checkout-rows superset values. Unknown states give `attention`.
- D-4. The lifecycle `neutral` tone maps to `muted`. Non-provider `active` maps to `lifecycle-active`.
- D-5. Chip tints (`/10` backgrounds) are dropped. Only the `badge` size has a fill (`bg-pane-bg`).
- D-6. The content of the `Chip` remove control depends on P-2. If `shared/ui/CloseButton.tsx` exists, it renders `CloseButton size="chip" label={removeLabel}`. Otherwise it renders `IconX size={12}` from `shared/ui/icons`, and ticket 01 converts that single site. Either way the accessible name is `removeLabel`.
- D-7. The remove control is always visible, and the quiet hover-reveal is retired.
- D-8. The `ConversationRows` provider swatch stays outside `StatusDot`.

No user decision is open.
