# LLD 02 — TabStrip and Tab, applied to the header module tabs

| Field | Value |
| --- | --- |
| Work item | `02-tabstrip-header-module-tabs` (local tracker, `.scratch/shared-ui-components/issues/02-tabstrip-header-module-tabs.md`) |
| Parent | Story "Shared UI component library for Studio" (`.scratch/shared-ui-components/spec.md`) |
| Module | Ticketry Studio frontend, `studio/src` |
| Blocked by | 01 (`DropSeam`, `CloseButton`; API fixed in `../01-drop-seam-and-close-button/LLD.md` §5) |
| Blocks | 03 (`boxed`, `plain`), 04 (`pill`, `rail`, tab-look toggle) |
| Status | Implementation-ready once 01 has landed |
| Authority | This `LLD.md` is authoritative. `LLD.html` is a presentation mirror. |

## 1. Behaviour delivered

- A shared `TabStrip` and `Tab` in `studio/src/shared/ui/TabStrip.tsx`, providing:
  - `role="tablist"`/`role="tab"` with `aria-selected` and roving tabindex;
  - arrow, Home, End, Enter and Space keys;
  - the active tab scrolled into view, with hidden-scrollbar overflow;
  - leading and trailing slots;
  - an optional `CloseButton` per tab;
  - drag-source and drop-target passthrough, with a `DropSeam`.
- The full variant union is declared now (`underline | boxed | plain | pill | rail`), so 03 and 04 add their styling without changing the API. Only `underline` is styled in this ticket.
- The header module selector (`ModuleTabStrip`/`ModuleTab`) renders through `TabStrip variant="underline"`. Hide, drag reorder, jump badges, lifecycle chicklets, the leading Modules toggle and the trailing `ModulePicker` behave as before.
- The hard-coded `#7aa2f7` underline becomes the Tailwind token `shadow-tab-underline`, used by the module tab and the footer Changes toggle.
- `ModulesPaneToggle` uses `useGlobalShortcutLabel`.
- `ModuleJumpBadge` renders its chord with `KeyBadge`.

Spec stories delivered: 1, 3, 4, 23, 25, 26 (API), 35–37.

## 2. Scope and invariants

In scope: the files in Section 4.

Invariants:

- Module selection, hide fallback (`handleHide`), drag reorder (`useModuleReorderDrag`, `consumePostDropClick`), jump-badge routing (`useModuleJumpBadges`, ⌘1–⌘9 / ⌘⇧0), and `ModulePicker` internals are unchanged.
- DOM contract relied on by tests (Section 3.3) is preserved:
  - the root is labelled `Project modules`;
  - its first element child is the Modules toggle;
  - the scroller is labelled `Scrollable project module tabs`, has `min-w-0 flex-1 overflow-x-auto`, and its first element child is the tablist labelled `Project module tabs`;
  - the tablist's next element sibling contains the picker;
  - each tab's parent element has `w-max shrink-0`;
  - the tab has `pr-7`;
  - the close button keeps the 01 classes;
  - the seam keeps `data-testid="module-tab-drop-seam"` and `data-drop-intent`, and renders inside the tab;
  - the tab keeps `data-module-id`;
  - the badge keeps `data-testid="module-jump-badge"`, `data-module-jump-position`, `aria-hidden="true"`, `absolute` and `pointer-events-none`, and renders inside the tab.
- The selected tab's `className` does not change while ⌘ is held (`[overhaul-179]`).
- Global zone navigation (`useGlobalKeymap`) keeps owning arrow keys everywhere except while DOM focus is inside a roving `TabStrip` tablist (Section 5.5).

Out of scope:

- Styling of `boxed`, `plain`, `pill` and `rail` (03/04).
- The tab-look toggle export and the full migration of `FooterChangesToggle`/`ChangesToolbar` (04). This ticket only swaps the literal for the token.
- `ModulePicker` internals (08), `WorkspaceTabStrip`, `ShellTabStrip` (03) and `SettingsModal` rail (04).
- The other `#7aa2f7` literals in `features/agents/terminal/internal/entryPool.ts` and `features/documents/codeMirrorDarkTheme.ts`. They configure xterm and CodeMirror themes, not Tailwind tab chrome.

## 3. Repository findings (verified 2026-10-02 at `a2541323`; assumes 01 landed)

### 3.1 Instances

| File:lines | Today |
| --- | --- |
| `studio/src/app/shell/ticket-workspace/ModuleTabStrip.tsx:94-135` | Root `div aria-label="Project modules"` (`flex h-7 min-w-0 shrink-0 border-b border-pane-border bg-pane-title`) → `ModulesPaneToggle` → scroller `div aria-label="Scrollable project module tabs"` (`flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`) → `div role="tablist" aria-label="Project module tabs"` (`flex shrink-0`) → `ModuleTab`s, then `ModulePicker` as the tablist's sibling. `tabRefs`/`registerRef` (35-43) and a `useEffect` (86-92) call `scrollIntoView({ block: "nearest", inline: "nearest" })` on the selected tab when `selectedModuleId`, `loading` or `moduleOrderKey` (82-84) changes. Hide fallback is `handleHide` (53-80). |
| `studio/src/app/shell/ticket-workspace/ModuleTab.tsx:37-93` | Wrapper `div` (`group relative flex w-max shrink-0 border-r border-pane-border`) → `button role="tab" tabIndex={-1}` with `data-module-id`, `aria-label`, `title`, drag props, merged ref, classes `relative flex min-w-0 flex-1 items-center py-0 pr-7 pl-3 text-xs` + selected `bg-pane-panel font-semibold text-text-primary shadow-[inset_0_-2px_0_0_#7aa2f7]` or idle `text-text-muted hover:bg-pane-panel hover:text-text-primary`; children `DropSeam` (from 01), name span (`truncate`), `ModuleLifecycleChicklets`, `ModuleJumpBadge`; sibling `CloseButton` (from 01). |
| `studio/src/app/shell/ticket-workspace/ModulesPaneToggle.tsx:10-23` | Re-implements `useGlobalShortcutLabel`: `useSyncExternalStore(studioKeymapRegistry.subscribe, getRevision)` plus `getEffectiveBindings().find(global, "toggle-sidebar")` and `formatChordSymbols(binding.chord)`. |
| `studio/src/app/navigation/useGlobalShortcutLabel.ts:19-25` | `useGlobalShortcutLabel(actionId)` returns `globalShortcutLabel(actionId)`, which uses `getEffectiveBinding("global", actionId)` (same binding as above) and upper-cases single-letter keys. |
| `studio/src/features/module-tabs/ModuleJumpBadge.tsx:9-16` | Own span: `pointer-events-none absolute top-1/2 right-1 inline-flex -translate-y-1/2 select-none items-center border border-pane-border bg-pane-bg px-1 font-mono text-[10px] font-normal leading-4 text-text-muted`. |
| `studio/src/shared/ui/KeyChordHint.tsx:11-23` | `KeyBadge({ children, tone = "accent" })` renders `bg-pane-bg px-1.5 py-0.5 font-bold text-focus-accent`. No `className` or data passthrough. |
| `studio/src/app/shell/FooterChangesToggle.tsx:56` | Active class string contains `shadow-[inset_0_-2px_0_0_#7aa2f7]`. |
| `studio/tailwind.config.ts:19-21` | `colors.focus.accent = "#7aa2f7"`; no `boxShadow` extension. |

### 3.2 Keyboard ownership today

- `studio/src/app/navigation/useGlobalKeymap.ts` registers `window` keydown listeners in the capture phase (`onCaptureKeyDown`, line 207) and the bubble phase (`onKeyDown`, line 208).
- The capture handler resolves `capture`-context bindings, including `edit-view.left`/`right`/`up`/`down` on bare arrows and `edit-view.commit` on Enter (`keymapBindings.ts:80-115`). It routes them through zone navigation, which calls `consume(event)` (`navigationContext.ts:82-85`, `preventDefault` + `stopPropagation`).
- Window capture runs before React's root listener, so a consumed arrow never reaches a React `onKeyDown` on a focused tab.
- There is precedent for a DOM-focus exemption: `isLaunchMenuTarget` (`useGlobalKeymap.ts:35-38`, checked at line 80).
- The bubble handler runs `routeThreeZoneBodyEngagement` before its `defaultPrevented` check, and resolves `global` bindings `focus-left`/`focus-right` on bare arrows (`keymapBindings.ts:230-231`).
- Module tabs are all `tabIndex={-1}` today and have no arrow handling.

### 3.3 Guarding tests

| Test | What it pins |
| --- | --- |
| `src/test/overhaulModuleTabCloseAcceptance.test.tsx` `[overhaul-183]` | Renders `ModuleTab` standalone (no strip). Tab parent `w-max shrink-0`; tab `pr-7`; close `h-full w-7`, not `hover:bg-pane-bg`; close's first `span` has `size-4`, `group-hover/close:bg-pane-bg`, `group-hover/close:text-text-primary`. Passes `registerRef={vi.fn()}`. |
| `src/test/overhaulModuleTabReorderAcceptance.test.tsx` `[overhaul-52]` and others | Root/scroller/tablist/picker sibling structure; picker not draggable; seam `data-drop-intent`; seam inside the tab; selected tab scrolled into view again after a reorder; post-drop click ignored. |
| `src/test/overhaulModulePickerAcceptance.test.tsx` `[overhaul-237]`, hide fallback | `getByLabelText("Project modules")` first child is the toggle; scroller classes `min-w-0 flex-1 overflow-x-auto`; tablist next sibling contains picker; `Hide Alpha tab` fallback selection. |
| `src/test/overhaulModuleJumpBadgesAcceptance.test.tsx` `[overhaul-179]` | Mounts `useGlobalKeymap` with `ModuleTabStrip`; badge text `⌘1`…`⌘9`; tab `className` stable while ⌘ held; tab parents `w-max`; badge `absolute`, `pointer-events-none`, `aria-hidden`, inside its tab. |
| `src/test/overhaulModuleVisibilityAcceptance.test.tsx`, `overhaulModuleOrderAcceptance.test.tsx`, `overhaulCaptureDraftAcceptance.test.tsx` | `data-module-id`, hide flows, `Open/Close Modules pane` toggle. |
| `e2e/web-app.spec.ts`, `e2e/support.ts` | `modules-pane-toggle` test id; `Hide … tab`. Not part of the vitest gate, but must not be broken. |

No test asserts `#7aa2f7` or `inset_0_-2px` (grep of `studio/src`), so the token swap changes no assertion.

### 3.4 Preflight gates

Stop and report if:

- 01's `DropSeam` and `CloseButton` are not merged with the API in `../01-drop-seam-and-close-button/LLD.md` §5.
- `ModuleTab` still contains inline seam or close markup.
- `useGlobalKeymap.ts` no longer has the capture/bubble split described in 3.2.

## 4. File and component change map

| ID | Path | Action | Responsibility after change |
| --- | --- | --- | --- |
| F1 | `studio/src/shared/ui/TabStrip.tsx` | Create | `TabStrip`, `Tab`, variant union and per-variant class tables. The only tab-strip markup in Studio once 03/04 land. |
| F2 | `studio/src/shared/ui/tabStripKeys.ts` | Create | Pure key-to-action mapping, plus the predicate the global keymap uses to yield roving keys to a focused strip. |
| F3 | `studio/src/shared/ui/TabStrip.test.tsx` | Create | Behaviour test for F1/F2. |
| F4 | `studio/tailwind.config.ts` | Modify | Adds `boxShadow["tab-underline"]` derived from the focus accent. |
| F5 | `studio/src/app/shell/ticket-workspace/ModuleTabStrip.tsx` | Modify | Composes `TabStrip`; keeps selection, hide and reorder wiring. |
| F6 | `studio/src/app/shell/ticket-workspace/ModuleTab.tsx` | Modify | Maps a `Module` onto `Tab`. |
| F7 | `studio/src/app/shell/ticket-workspace/ModulesPaneToggle.tsx` | Modify | Uses `useGlobalShortcutLabel("toggle-sidebar")`. |
| F8 | `studio/src/features/module-tabs/ModuleJumpBadge.tsx` | Modify | Positions a `KeyBadge`. |
| F9 | `studio/src/app/shell/FooterChangesToggle.tsx` | Modify | Literal → `shadow-tab-underline` (one class). |
| F10 | `studio/src/app/navigation/useGlobalKeymap.ts` | Modify | Yields roving keys to a focused `TabStrip`. |
| F11 | `studio/src/test/overhaulModuleTabKeyboardAcceptance.test.tsx` | Create | Header tabs keyboard behaviour with the global keymap mounted. |
| F12 | `studio/src/test/overhaulModuleTabCloseAcceptance.test.tsx` | Modify | Drops the removed `registerRef={vi.fn()}` prop. No assertion changes. |
| F13 | `studio/src/shared/ui/KeyChordHint.tsx` | Untouched | `KeyBadge` reused as is. |
| F14 | `studio/src/app/navigation/useGlobalShortcutLabel.ts` | Untouched | Reused as is. |
| F15 | `studio/src/features/module-tabs/ModulePicker.tsx`, `studio/src/features/projects` (`useModuleReorderDrag`) | Untouched | Trailing slot and drag controller. |
| F16 | `studio/src/shared/ui/DropSeam.tsx`, `studio/src/shared/ui/CloseButton.tsx` | Untouched | Consumed with the 01 API. |

### F1 `shared/ui/TabStrip.tsx` (create, target ≤ 250 lines)

- Exports:
  - components `TabStrip` and `Tab`;
  - types `TabStripVariant`, `TabStripKeyboard`, `TabStripZoneChrome`, `TabStripProps`, `TabProps`, `TabClose`;
  - type `DataAttributes`, defined in this file as `` Partial<Record<`data-${string}`, string>> ``.
- Imports: `CloseButton` from `./CloseButton`, `DropSeam` from `./DropSeam`, `tabStripKeyAction`/`TAB_STRIP_ATTRIBUTE` from `./tabStripKeys`, and types `DragSourceProps`, `DropTargetProps`, `DropIntent` from `../dragDrop/useAxisDragAndDrop`.
- Holds a module-private React context `TabStripContext` of `{ variant, keyboard }`. Its default value is `{ variant: "underline", keyboard: "roving" }`, so a `Tab` rendered outside a strip (as `[overhaul-183]` does with `ModuleTab`) behaves as an underline roving tab.
- Holds one module-private table `VARIANT_CLASSES: Record<TabStripVariant, VariantClasses>`. `VariantClasses` has keys `root`, `scroller`, `tablist`, `wrapper`, `tab`, `tabClosable`, `tabPlain`, `selected`, `idle`, `closeClassName` and `closeReveal`. The `boxed`, `plain`, `pill` and `rail` entries are the same object as `underline` in this ticket. 03 and 04 each replace only their own entry and must not touch the props.
- Holds `ORIENTATION: Record<TabStripVariant, "horizontal" | "vertical">`: `rail` → `vertical`; every other variant → `horizontal`. It is used for keys, `aria-orientation` and the `DropSeam` axis.
- Does not own selection state, data fetching, drag controllers, or what a tab's content is.

### F2 `shared/ui/tabStripKeys.ts` (create, ≤ 50 lines)

- `TAB_STRIP_ATTRIBUTE = "data-tab-strip"`. The value is the orientation, written on the tablist element only when `keyboard="roving"`.
- `tabStripKeyAction(event, orientation)`:
  - Signature: `(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">, orientation: "horizontal" | "vertical") => "previous" | "next" | "first" | "last" | "activate" | null`.
  - Any modifier returns `null`.
  - Horizontal: `ArrowLeft` → `previous`, `ArrowRight` → `next`.
  - Vertical: `ArrowUp` → `previous`, `ArrowDown` → `next`.
  - Both orientations: `Home` → `first`, `End` → `last`, `Enter` and `" "` → `activate`.
  - Everything else returns `null`.
- `isTabStripKeyEvent(event: KeyboardEvent): boolean`:
  - Returns true only when `event.target` is an `Element` whose `closest("[data-tab-strip]")` exists.
  - The target must itself be a `[role="tab"]`, or a descendant of the tab wrapper inside that tablist (for example its close button).
  - `tabStripKeyAction(event, <attribute value>)` must be non-null.
- Pure; no React.

### F3 `shared/ui/TabStrip.test.tsx` (create)

See Section 7.1.

### F4 `tailwind.config.ts` (modify)

- Add `const FOCUS_ACCENT = "#7aa2f7";` above `config` and use it for `colors.focus.accent`.
- Add `theme.extend.boxShadow = { "tab-underline": \`inset 0 -2px 0 0 ${FOCUS_ACCENT}\` }`. This generates `shadow-tab-underline`.
- Leave `lifecycle.idle` and every other value unchanged.

### F5 `ModuleTabStrip.tsx` (modify)

- Remove `useRef` and `useEffect` imports, `tabRefs`, `registerRef` and the scroll `useEffect` (lines 35-43, 86-92).
- Keep `moduleOrderKey`, and pass it into `scrollKey`.
- Render `TabStrip` with:
  - `variant="underline"`;
  - `label="Project module tabs"`, `regionLabel="Project modules"`, `scrollLabel="Scrollable project module tabs"`;
  - `leading={<ModulesPaneToggle />}`;
  - `trailing={!loading ? <ModulePicker modules={modules} presentations={presentations} onCreate={() => pushModal({ type: "add-module" })} /> : null}`;
  - ``scrollKey={loading ? "loading" : `${selectedModuleId ?? ""}|${moduleOrderKey}`}``.
- Children: when not loading, `shownModules.map(...)` to `ModuleTab` with the same props as today minus `registerRef`.
- `handleSelect`, `handleHide`, `dragDrop` and `moduleJumpBadges` are unchanged.
- Import `{ TabStrip }` from `../../../shared/ui/TabStrip`.

### F6 `ModuleTab.tsx` (modify)

- Props after change are `module`, `isSelected`, `dropIntent`, `onSelect`, `onHide`, `jumpBadge?`, `dragSourceProps?` and `dropTargetProps?`. `registerRef` is deleted because `TabStrip` owns scrolling.
- Render one `Tab` with:
  - `selected={isSelected}`, `accessibleName={module.name}`, `title={module.name}`;
  - `onSelect={() => onSelect(module.id)}`;
  - `tabAttributes={{ "data-module-id": module.id }}`;
  - `dragSourceProps={dragSourceProps}`, `dropTargetProps={dropTargetProps}`, `dropIntent={dropIntent}`, `dropSeamTestId="module-tab-drop-seam"`;
  - `close={{ label: "Hide " + module.name + " tab", title: "Hide tab", onClose: () => onHide(module.id) }}`.
- Children, in order: `<span className="truncate">{module.name}</span>`, `<ModuleLifecycleChicklets moduleId={module.id} />`, and `jumpBadge ? <ModuleJumpBadge badge={jumpBadge} /> : null`.
- Remove the `DropSeam`/`CloseButton` imports added by 01; add `{ Tab }` from `../../../shared/ui/TabStrip`.

### F7 `ModulesPaneToggle.tsx` (modify)

- Replace lines 10-23 with `const shortcut = useGlobalShortcutLabel("toggle-sidebar");`, and render `{shortcut ? <KeyBadge>{shortcut}</KeyBadge> : null}`.
- Remove imports of `useSyncExternalStore`, `formatChordSymbols` and `studioKeymapRegistry`; add `{ useGlobalShortcutLabel }` from `../../navigation/useGlobalShortcutLabel`.
- `data-testid="modules-pane-toggle"`, `aria-label`, `aria-expanded`, `title`, classes and icon are unchanged.
- Behaviour delta: a user rebinding the action to a single letter now sees it upper-cased (`B`, not `b`), matching every other `useGlobalShortcutLabel` hint. The default `\` is unaffected.

### F8 `ModuleJumpBadge.tsx` (modify)

- Outer span keeps `aria-hidden="true"`, `data-module-jump-position={badge.position}` and `data-testid="module-jump-badge"`.
- Its classes become positioning only: `pointer-events-none absolute top-1/2 right-1 inline-flex -translate-y-1/2 select-none items-center text-xs font-normal leading-4`.
- Its child is `<KeyBadge>{badge.label}</KeyBadge>`. Import `{ KeyBadge }` from `../../shared/ui/KeyChordHint`.
- Visible delta: the badge now uses the shared keycap look (accent ink, bold, `bg-pane-bg`) instead of the bordered muted chip, so story 23 holds. The off-scale `text-[10px]` is dropped for the `xs` token.

### F9 `FooterChangesToggle.tsx` (modify)

- In line 56, replace `shadow-[inset_0_-2px_0_0_#7aa2f7]` with `shadow-tab-underline`.
- Nothing else changes. 04 moves the toggle onto the tab-look button.

### F10 `useGlobalKeymap.ts` (modify, +4 lines)

- Import `{ isTabStripKeyEvent }` from `../../shared/ui/tabStripKeys`.
- In `onCaptureKeyDown`, add `if (isTabStripKeyEvent(event)) return;` directly after `if (isLaunchMenuTarget(event.target)) return;`.
- In `onKeyDown`, add the same line as the first statement.
- With focus anywhere else, behaviour is unchanged.

### F11 `test/overhaulModuleTabKeyboardAcceptance.test.tsx` (create)

See Section 7.1. It reuses the harness pattern of `overhaulModuleJumpBadgesAcceptance.test.tsx`: the same `vi.mock`s for `readTransport`, `runtime` and Tauri, and a surface component calling `useGlobalKeymap()` and rendering `<ModuleTabStrip />`. The new file name matches the `test:overhaul` glob `overhaul*Acceptance.test.tsx`.

### F12 `test/overhaulModuleTabCloseAcceptance.test.tsx` (modify)

- Delete the single line `registerRef={vi.fn()}`. Without this, typecheck fails on an unknown prop.
- All `expect` lines stay byte-for-byte. This is the only edit to an existing test, and it is intentional.

## 5. Contracts

### 5.1 `TabStrip` props (`TabStripProps`)

| Prop | Type | Req. | Default | Behaviour |
| --- | --- | --- | --- | --- |
| `variant` | `TabStripVariant` = `"underline" \| "boxed" \| "plain" \| "pill" \| "rail"` | yes | — | Selects the class table entry and the orientation (`rail` vertical, others horizontal). |
| `label` | `string` | yes | — | `aria-label` of the `role="tablist"` element. |
| `children` | `ReactNode` | yes | — | `Tab` elements, in display order. |
| `regionLabel` | `string` | no | none | `aria-label` on the root element. |
| `scrollLabel` | `string` | no | none | `aria-label` on the scroller element. |
| `leading` | `ReactNode` | no | none | Rendered as the root's first child, before the scroller. Never scrolls; never part of the tablist. |
| `trailing` | `ReactNode` | no | none | Rendered inside the scroller as the tablist's next sibling, with no wrapper. Scrolls with the tabs; not part of the tablist. |
| `scrollKey` | `string` | no | none | On mount, and whenever the value changes, the strip calls `scrollIntoView({ block: "nearest", inline: "nearest" })` on the tablist's `[role="tab"][aria-selected="true"]`, if any. If omitted, it never scrolls automatically. |
| `keyboard` | `TabStripKeyboard` = `"roving" \| "external"` | no | `"roving"` | `roving`: roving tabindex, key handling, and `data-tab-strip` on the tablist. `external`: no key handler and no `data-tab-strip`; every tab has `tabIndex={-1}`. The caller's own keyboard system owns navigation (for the edit-view zone strip in 03). |
| `zoneChrome` | `TabStripZoneChrome` = `"none" \| "active" \| "dimmed"` | no | `"none"` | Edit-view zone emphasis on the tablist: `active` → `ring-1 ring-focus-accent ring-inset`; `dimmed` → `opacity-[0.65]`. Unused by header tabs. |
| `tablistRef` | `Ref<HTMLDivElement>` | no | none | Ref to the tablist element. |
| `tablistProps` | `{ tabIndex?: number; onFocus?: FocusEventHandler<HTMLDivElement>; onMouseDown?: MouseEventHandler<HTMLDivElement> } & DataAttributes` | no | none | Passthrough to the tablist element (zone hooks in 03). Its `data-*` must not include `data-tab-strip`. |
| `className` | `string` | no | none | Layout only on the root: margin, padding, min-height, flex placement. Never colour, border or typography. |

DOM structure (every variant):

- root `div`: `data-tab-strip-root`, `aria-label={regionLabel}`, and the variant's `root` classes plus `className`.
- `leading`, if given.
- scroller `div`: `aria-label={scrollLabel}`, the variant's `scroller` classes.
- tablist `div`: `role="tablist"`, `aria-label={label}`, `aria-orientation` (`vertical` for rail, else `horizontal`), `data-tab-strip={orientation}` when roving, `tablistProps`, the variant's `tablist` classes plus `zoneChrome` classes.
- the `Tab`s, inside the tablist.
- `trailing`, if given, inside the scroller after the tablist.

`data-tab-strip-root` exists so popovers anchored to a trailing slot (03's `WorkspaceLauncher` and `DormantWorkspaceTabs`) can use `closest("[data-tab-strip-root]")`.

### 5.2 `Tab` props (`TabProps`)

| Prop | Type | Req. | Default | Behaviour |
| --- | --- | --- | --- | --- |
| `selected` | `boolean` | yes | — | `aria-selected`; with roving keyboard, `tabIndex` 0 when selected, otherwise -1. |
| `onSelect` | `(event: MouseEvent<HTMLButtonElement>) => void` | yes | — | The tab button's click handler. Keyboard activation goes through the same handler (Section 5.4). |
| `accessibleName` | `string` | yes | — | `aria-label` of the tab. |
| `children` | `ReactNode` | yes | — | Visible content: label, badges, chicklets. |
| `title` | `string` | no | none | Native tooltip on the tab button. |
| `disabled` | `boolean` | no | `false` | Native `disabled`; skipped by roving keys. |
| `highlighted` | `boolean` | no | `false` | Keyboard-highlight axis independent of selection: `data-highlighted="true"` plus `ring-1 ring-focus-accent ring-inset`. |
| `toneClassName` | `string` | no | none | Valid only with `boxed`, and only from `providerToneClasses` (`features/agents/terminal/presentation/providerPresentation.ts`). Replaces the variant's `selected`/`idle` colour classes for provider identity. Ignored by the other variants. |
| `close` | `TabClose` = `{ label: string; onClose: (event: MouseEvent<HTMLButtonElement>) => void; title?: string; testId?: string }` | no | none | Renders a `CloseButton` (`size="chip"`) as the tab button's next sibling inside the wrapper, never inside the tab. `reveal` and `className` come from the variant (`underline`: `reveal="hover"`, `absolute top-0 right-0 h-full w-7`). `testId` maps to `data-testid`. A closable tab uses `tabClosable` padding (`pr-7` for underline); otherwise `tabPlain` (`pr-3`). |
| `dragSourceProps` | `DragSourceProps` | no | none | Spread on the tab button. |
| `dropTargetProps` | `DropTargetProps` | no | none | Handlers spread on the tab button; its `ref` is merged with `tabRef`. |
| `dropIntent` | `DropIntent \| null` | no | `null` | Passed to a `DropSeam` rendered as the tab button's first child, with axis `horizontal` (rail: `vertical`). |
| `dropSeamTestId` | `string` | no | `"tab-drop-seam"` | `data-testid` of that seam. |
| `tabRef` | `(node: HTMLButtonElement \| null) => void` | no | none | Callback ref to the tab button. |
| `tabAttributes` | `DataAttributes` | no | none | `data-*` on the tab button (e.g. `data-module-id`). |
| `wrapperAttributes` | `DataAttributes` | no | none | `data-*` on the wrapper (e.g. 03's `terminal-panel-tab` hooks). |

Tab DOM:

- wrapper `div`: the variant's `wrapper` classes and `wrapperAttributes`.
- tab `button`: `type="button"`, `role="tab"`, `aria-selected`, `aria-label`, `tabIndex`, `title`, `disabled`, `tabAttributes`, drag and drop props. Classes: `tab` + (`tabClosable` | `tabPlain`) + (`toneClassName` | `selected` | `idle`) + highlighted ring + `disabled:cursor-not-allowed disabled:opacity-50`.
- Inside the tab button: the `DropSeam`, then `children`.
- `CloseButton`, if `close` is given, as the tab button's next sibling.

### 5.3 `underline` class table (implemented here)

| Key | Classes |
| --- | --- |
| `root` | `flex h-7 min-w-0 shrink-0 border-b border-pane-border bg-pane-title` |
| `scroller` | `flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden` |
| `tablist` | `flex shrink-0` |
| `wrapper` | `group relative flex w-max shrink-0 border-r border-pane-border` |
| `tab` | `relative flex min-w-0 flex-1 items-center py-0 pl-3 text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus-accent` |
| `tabClosable` / `tabPlain` | `pr-7` / `pr-3` |
| `selected` | `bg-pane-panel font-semibold text-text-primary shadow-tab-underline` |
| `idle` | `text-text-muted hover:bg-pane-panel hover:text-text-primary` |
| `closeClassName` / `closeReveal` | `absolute top-0 right-0 h-full w-7` / `"hover"` |

Tokens used: `pane-border`, `pane-title`, `pane-panel`, `text-primary`, `text-muted`, `focus-accent`, and the new `shadow-tab-underline`. Tailwind composes `ring-*` and `shadow-*` through separate variables, so the focus ring and the underline coexist.

### 5.4 Keyboard and focus (`keyboard="roving"`)

- The tablist `onKeyDown` handler runs only when `event.target` is a `[role="tab"]` inside this tablist. Keys on a close button or other wrapper content are ignored here and keep their native behaviour.
- It calls `tabStripKeyAction(event, orientation)`. For a non-null action it calls `event.preventDefault()`.
  - `previous`/`next` move to the adjacent enabled tab in DOM order, wrapping at the ends.
  - `first`/`last` move to the first/last enabled tab.
  - Moving means `target.focus()` then `target.click()`. Selection therefore follows focus (automatic activation), through the tab's own `onSelect`, and the same post-drop click guard applies.
  - `activate` calls `click()` on the focused tab.
- `aria-selected` and `tabIndex` follow the caller's `selected` prop. A tab that has focus before its caller re-renders keeps focus.
- If no tab is selected, no tab has `tabIndex={0}`, so the strip is reached by pointer or by the caller's keyboard routes only. This is the same as today's all-`-1` header tabs. Known limit; no caller in this ticket hits it while modules are visible.
- Close buttons stay in the natural Tab order, as today.

### 5.5 Global keymap yield

- `isTabStripKeyEvent` makes both `useGlobalKeymap` listeners return early for unmodified roving keys whose target is inside a roving tablist. The capture handler can then no longer consume them as `edit-view.*`, and the bubble handler can no longer route them as `focus-left`/`focus-right`, `modules.activate` or body engagement.
- Modified chords (⌘1–⌘9, ⌘⇧0, ⌘←/⌘→, ⌘W) are never yielded.
- Inside open modals the capture handler already returns early through `hasOpenModal()`, so 04's Settings rail is unaffected.

### 5.6 Compatibility summary

| Hook | Kept by |
| --- | --- |
| `Project modules`, `Scrollable project module tabs`, `Project module tabs` labels | F5 props `regionLabel`, `scrollLabel`, `label` |
| Toggle first child of root; picker next sibling of tablist | 5.1 DOM order |
| `data-module-id` | F6 `tabAttributes` |
| `module-tab-drop-seam`, `data-drop-intent`, seam inside tab | F6 `dropSeamTestId`; 5.2 seam placement |
| `Hide <name> tab`, `title="Hide tab"`, close classes | F6 `close`; 5.3 `closeClassName`; 01 CloseButton chip neutral |
| `w-max shrink-0` parent, `pr-7` | 5.3 `wrapper`, `tabClosable` |
| `module-jump-badge` and its attributes | F8 outer span |

## 6. Runtime flows and failure semantics

- **Pointer select.** A click on the tab runs `Tab.onSelect`, then `ModuleTab`'s `onSelect(module.id)`, then `handleSelect`. Post-drop clicks are ignored by `consumePostDropClick`; otherwise `selectModule`. Unchanged.
- **Keyboard select.**
  1. Focus sits on a module tab; the user presses ArrowRight.
  2. The window capture handler yields (F10), and React's tablist `onKeyDown` resolves `next`.
  3. It calls `preventDefault`, focuses the next enabled tab, and calls `click()`.
  4. This runs `handleSelect` and `selectModule`.
  5. `selectedModuleId` changes, so `scrollKey` changes and the new tab scrolls into view.
  6. The bubble handler yields too (F10).
  7. If `selectModule` rejects, the existing store error path applies. Focus remains on the tab the user moved to, with `aria-selected` still on the old tab until the store changes. No retry.
- **Hide.** A click on `CloseButton` runs `onHide(module.id)` and `handleHide` (fallback selection, then `setTabHidden`). The click never reaches the tab, because the close is a sibling.
- **Reorder.** The drag controller behaves as today. `moduleOrderKey` changes, so `scrollKey` changes, so the selected tab is scrolled back into view (`[overhaul-52]`).
- **Loading.** No tabs and no picker render, and `scrollKey` is `"loading"`. When loading finishes, the key changes and the selected tab scrolls into view, as today.
- **Unstyled variants.** Rendering `boxed`, `plain`, `pill` or `rail` before 03/04 land uses the underline styling with the correct orientation. No caller does this in 02.

## 7. Verification

### 7.1 New tests

`studio/src/shared/ui/TabStrip.test.tsx` (vitest + `@testing-library/react`, `fireEvent`, `Element.prototype.scrollIntoView = vi.fn()` in `beforeEach`; no class-string assertions):

1. Roles: `getByRole("tablist", { name })` and three `tab`s. The selected tab has `aria-selected="true"` and `tabIndex` 0; the others are -1.
2. ArrowRight on the selected tab focuses the next tab (`document.activeElement`) and calls its `onSelect`. ArrowLeft on the first tab wraps to the last. Home and End go to the first and last. The `fireEvent.keyDown` result is `false` (default prevented).
3. Enter and Space on a focused tab call that tab's `onSelect`.
4. `close`: the close button has the given accessible name. Clicking it calls `onClose` and not `onSelect`. ArrowRight on the focused close button calls no `onSelect`.
5. A `disabled` middle tab is skipped by ArrowRight.
6. `scrollKey`: on mount, `scrollIntoView` is called once on the selected tab with `{ block: "nearest", inline: "nearest" }`. A re-render with the same key makes no call; a new key makes one call.
7. `variant="rail"`: the tablist has `aria-orientation="vertical"`. ArrowDown and ArrowUp move; ArrowRight does nothing.
8. `keyboard="external"`: every tab has `tabIndex` -1; ArrowRight calls nothing; the tablist has no `data-tab-strip`.
9. Modifier: ⌘+ArrowRight calls nothing and is not default-prevented.
10. Structure: `leading` is the root's first element child; `trailing` is the tablist's next element sibling; both are outside the tablist.
11. Drag: `dropIntent="far"` renders `getByTestId(dropSeamTestId)` inside the tab with `data-drop-intent="far"`; `dragSourceProps` puts `draggable="true"` on the tab.
12. `Tab` outside a `TabStrip` renders a `role="tab"` that is focusable when selected (the context default).
13. `isTabStripKeyEvent`: true for ArrowRight on a tab inside a roving strip; false for the same key on a `trailing` button and on a tab in an `external` strip.

`studio/src/test/overhaulModuleTabKeyboardAcceptance.test.tsx` uses the jump-badge harness: thirteen modules, `module-2` hidden, `module-4` archived, `selectedModuleId: "module-1"`, and `selectModule` updating the store.

1. Focus the `Module 1` tab and press ArrowRight. `selectModule` is called with `module-3` and focus is on the `Module 3` tab. This proves the capture handler yielded.
2. Press End. `selectModule` is called with the last visible module, and that tab is focused.
3. Press Enter on a focused tab. `selectModule` is called with that tab's module.
4. With focus on `document.body`, ArrowRight calls no `selectModule`. Global routing is unchanged off the strip.

### 7.2 Regression suites (unchanged except F12's prop line)

- Every test in Section 3.3.
- `npm run typecheck`.
- `npm run test --workspace @worktracker/studio`.
- `npm run test:overhaul --workspace @worktracker/studio`.

### 7.3 Static checks

- `rg -n '7aa2f7' studio/src/app/shell studio/src/shared/ui` reports nothing.
- `rg -n '7aa2f7' studio/tailwind.config.ts` reports only the `FOCUS_ACCENT` constant.
- `rg -n 'useSyncExternalStore' studio/src/app/shell/ticket-workspace/ModulesPaneToggle.tsx` reports nothing.

## 8. Ordered implementation plan

| Step | Files | Change | Depends on | Local signal |
| --- | --- | --- | --- | --- |
| 1 | F4 | Add `FOCUS_ACCENT` and `shadow-tab-underline`. | — | `npm run build --workspace @worktracker/studio` emits the class once used |
| 2 | F2 | Key mapping and `isTabStripKeyEvent`. | — | Typecheck |
| 3 | F1, F3 | `TabStrip`/`Tab` with the full union, underline table, and tests. | 01, 1, 2 | `vitest run src/shared/ui/TabStrip.test.tsx` |
| 4 | F6, F12 | `ModuleTab` on `Tab`; drop `registerRef` and its test prop. | 3 | `overhaulModuleTabCloseAcceptance` |
| 5 | F5 | `ModuleTabStrip` on `TabStrip`. | 4 | `overhaulModuleTabReorderAcceptance`, `overhaulModulePickerAcceptance`, `overhaulModuleVisibilityAcceptance`, `overhaulModuleOrderAcceptance` |
| 6 | F10, F11 | Global keymap yield and keyboard acceptance. | 5 | `overhaulModuleTabKeyboardAcceptance`, `overhaulModuleJumpBadgesAcceptance` |
| 7 | F7, F8 | Toggle hook and `KeyBadge` badge. | — | `overhaulModuleJumpBadgesAcceptance`, `overhaulCaptureDraftAcceptance` |
| 8 | F9 | Footer token swap. | 1 | `overhaulModuleVersionControlAcceptance`, `overhaulTaskWorktreeChangesAcceptance` |
| 9 | — | Static checks, typecheck, studio tests, `test:overhaul`. | 1–8 | All green |

If any guard other than F12 requires an edit, stop and record why; do not adjust assertions silently.

## 9. Acceptance mapping

| Ticket criterion | Steps | Signal |
| --- | --- | --- |
| AC-1 `shared/ui/TabStrip.tsx` (with `Tab`) exists, `underline` implemented, union declared for `boxed`, `plain`, `pill`, `rail` | 3 | `TabStripVariant` has five members; `VARIANT_CLASSES` is a full `Record`; F3 passes |
| AC-2 Test: arrows move focus and selection, Enter/Space selects, close does not select, active tab scrolls into view | 3, 6 | F3 cases 2, 3, 4, 6; F11 cases 1–3 |
| AC-3 Header tabs render through `TabStrip`; hide, drag reorder, jump badge and chicklets behave as before | 4, 5, 7 | Guards in 3.3 green |
| AC-4 No `#7aa2f7` in the tab or footer toggle; the token lives in `tailwind.config.ts` | 1, 4, 8 | Static checks 7.3 |
| AC-5 Typecheck, studio tests and `test:overhaul` pass | 9 | Commands in 7.2 |
| Instance: `ModulesPaneToggle` uses `useGlobalShortcutLabel` | 7 | Static check 7.3; toggle suites green |
| Instance: `ModuleJumpBadge` uses `KeyBadge` | 7 | `[overhaul-179]` green |

## 10. Decisions recorded

- D-1 Keyboard activation dispatches `click()` on the target tab instead of adding a strip-level `onSelect(value)`. There is one selection path (the tab's own `onSelect`), `Tab` works without a strip, and no value or id prop is needed.
- D-2 `TabStrip` owns scroll-into-view through `scrollKey` and a DOM query for the selected tab. This removes `ModuleTabStrip`'s ref map and `ModuleTab.registerRef`. Cost: F12's one-line test edit.
- D-3 The roving keys are yielded by `useGlobalKeymap` through `isTabStripKeyEvent`, following the `isLaunchMenuTarget` precedent. Without it, the window capture listener consumes arrows and Enter before any tab sees them.
- D-4 `keyboard="external"`, `zoneChrome`, `tablistRef`, `tablistProps`, `highlighted`, `toneClassName`, `wrapperAttributes` and `data-tab-strip-root` exist now so 03 can migrate the edit-view workspace strip without an API change. Header tabs use none of them.
- D-5 `toneClassName` is the one sanctioned colour input. It is restricted to `boxed` and to `providerToneClasses` output, because provider identity is a domain colour axis owned by the agents feature, not a tab variant.
- D-6 Unstyled variants reuse the underline table entry until 03/04, instead of throwing.
- D-7 `ModuleJumpBadge` adopts the `KeyBadge` look (accent, bold). This is a visible change, required by story 23.
