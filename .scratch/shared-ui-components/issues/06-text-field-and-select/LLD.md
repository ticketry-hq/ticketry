# LLD — 06 TextField, TextArea, Select and Checkbox

Status: implementation-ready (no open material decision)
Work item: `.scratch/shared-ui-components/issues/06-text-field-and-select.md`
Parent story: `.scratch/shared-ui-components/spec.md` (Shared UI component library for Studio)
Scope: Studio frontend, `studio/src` only
Authority: this file is authoritative. `LLD.html` in the same directory is its presentation mirror.

## 1. Identity and design basis

This LLD delivers user story 15 ("text inputs and selects share one border and focus style") and developer story 29 ("`TextField` and `Select` replace `SETTINGS_FIELD_CLASS` and the ring and border variants"), plus the parts of stories 25, 34, 35 and 37 that apply to form fields.

Authoritative inputs, in order: the repository `CLAUDE.md` (layout and naming rules), the story spec's Implementation Decisions ("TextField and Select", "Styling", "Variant API", "Migration strategy") and Testing Decisions, then the ticket. Where the ticket's line numbers and the code disagree, the code (verified on `main` at `a2541323`) wins; section 3 records each check.

This LLD supersedes nothing. It is ticket 06 of 12; ticket coordination is in section 11.

## 2. Scope and invariants

### In scope

- New shared components in `studio/src/shared/ui/`: `TextField`, `TextArea`, `Select`, `Checkbox`, and the internal style module `fieldStyle.ts` they share.
- Migration of every instance listed in the ticket (16 elements in 14 files), every `SETTINGS_FIELD_CLASS` caller (13 elements in 8 files) and every `SETTINGS_CHECKBOX_CLASS` caller (8 elements in 4 files).
- Deletion of `SETTINGS_FIELD_CLASS` and `SETTINGS_CHECKBOX_CLASS` from `shared/ui/SettingsPrimitives.tsx`.
- One explicit, deliberate change to an existing acceptance assertion (`overhaulTypographyReadabilityAcceptance.test.tsx`, section 9.3).
- Colocated behaviour tests for the four components.

### Invariants (must not change)

- Every accessible name (`aria-label`, wrapping `<label>` text, `htmlFor`/`id` pairs), every `data-testid`, every `data-coach-anchor`, every `id`, and every ARIA combobox attribute (`role`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-autocomplete`, `aria-describedby`) on a migrated element stays byte-identical.
- Every event handler, `value`/`checked` binding, `autoFocus`, `disabled`, `readOnly`, `maxLength`, `rows`, `placeholder`, `spellCheck`, `type` and `ref` on a migrated element stays identical. No screen gains or loses behaviour.
- The description editor's focus behaviour is unchanged (section 8).
- No production file outside the change map is edited. No new dependency is added. No `rounded*` utility or radius is introduced (guarded by `overhaulSquareCornersAcceptance`).

### Intended visual changes (accepted by the spec's "one style")

- All text fields, textareas and selects use one border plus focus-border look: border `pane-border`, focus border `focus-accent`, background `pane-bg`. The ring style (`ring-1 ring-pane-border focus:ring-focus-accent`) and `SETTINGS_FIELD_CLASS`'s extra `focus:ring-1 focus:ring-focus-accent` are gone.
- `DialogHost`'s select loses the dead `focus:border-accent-primary` (no such token exists in `studio/tailwind.config.ts`; today it has no visible focus border) and gains `focus-accent`.
- Per-element differences listed in the change map (section 6, "Visible change" column).

### Out of scope

- `shared/ui/PopoverSearch.tsx` (owned by ticket 07; see decision D-9).
- Inputs not in the ticket inventory whose look is a different control type: listed in section 3.3 and left untouched.
- Buttons, error lines, headings and close buttons next to migrated fields (tickets 05, 10, 01).
- The internals of `ModulePicker` and `MergeDestinationPicker` beyond the single input element (ticket 08).

## 3. Repository findings and preflight gates

### 3.1 Platform facts

- React `^18.3.1` (`studio/package.json`): `ref` is not a prop, so every component uses `forwardRef`. Precedent: `app/shell/PaneShell.tsx`, `features/workflows/ModelConfigurationPanel.tsx`.
- Tailwind `3.4.19`: arbitrary `aria-[invalid=true]:` variants are supported. No `clsx` or `tailwind-merge` is installed; class strings are joined with a space.
- Tests: vitest `^2.1.8` with jsdom, `@testing-library/react ^16.1.0`, `@testing-library/jest-dom` (matchers `toBeDisabled`, `toBeInvalid`, `toHaveFocus`, `toHaveAccessibleName`). `@testing-library/user-event` is not installed; tests use `fireEvent`. Vitest includes `src/**/*.test.{ts,tsx}`, so colocated tests under `shared/ui/` run in `npm run test --workspace @worktracker/studio`. Colocated precedent: `shared/dragDrop/useAxisDragAndDrop.test.tsx`, `features/work-items/WorkItemSearchList.test.tsx`.
- `shared/ui` exports are named, except the `Popover*` default exports. New components use named exports.
- `app/__tests__/moduleBoundaries.test.ts` forbids `shared/` importing from `app/` or `features/`. The new components import only from `react` and `./fieldStyle`.

### 3.2 Theme tokens used (all exist in `studio/tailwind.config.ts`)

`pane-bg` (#0a0a0a), `pane-border` (#2a2f3a), `focus-accent` (#7aa2f7), `text-primary`, `text-muted`, `lifecycle-danger` (#f7768e). Font sizes `text-xs` (11px), `text-sm` (12.5px), `text-base` (14px). `font-mono`. No token is added. `accent-primary` is not a token; its only field use (`DialogHost.tsx:85`) is removed here; its button uses in `DialogHost.tsx:7` belong to ticket 05.

### 3.3 Instance verification

Ticket line numbers were checked against the code. Where the ticket lists the `className` line, the element starts a few lines earlier; both are given.

| Ticket reference | Verified element (start–end lines) | Element | Notes |
| --- | --- | --- | --- |
| `ChildIssues.tsx:62` (select) and `:67` | 62–73 | select, `aria-label="Child issue type"`, `data-testid="add-subtask-type"` | Same element listed twice in the ticket |
| `ChildIssues.tsx:85` | 74–86 | input, `data-testid="add-subtask"`, placeholder "Add sub-task…" | |
| `KeyboardShortcutsModal.tsx:124` | 118–125 | input `type="search"`, `id="keyboard-shortcuts-filter"` | sr-only label at 115 |
| `ParentUpdate.tsx:133` | 125–134 | input `type="text"`, filter | No size class today (inherits) |
| `ModulePicker.tsx:214` | 200–215 | input `type="search"`, `role="combobox"`, `ref={searchRef}` | `text-base` today |
| `DialogHost.tsx:81` (select) and `:85` | 81–92 | select `ref={selectRef}` | Same element listed twice; `focus:border-accent-primary` is a dead class |
| `ConversationComposer.tsx:93` (select) and `:99` | 93–107 | select, `aria-label="Agent for the new conversation"` | Same element listed twice |
| `MergeDestinationPicker.tsx:60` | 48–60 (handlers continue to 89) | input `role="combobox"` | `pr-6` reserves room for the "▾" span at 90 |
| `AddProject.tsx:56` | 50–57 | input, name | ring style, mono |
| `AddProject.tsx:67` | 61–68 | input, key, `maxLength={3}` | ring style, mono, `uppercase` |
| `AddModule.tsx:186` | 176–187 | input, `id={moduleNameId}`, `data-coach-anchor="module-name"` | ring style, mono |
| `PromptInput.tsx:74` | 69–76 | textarea `ref={textAreaRef}` (`initialFocusRef`) | ring style, mono |
| `ModuleFolderSelection.tsx:113` | 102–114 | input, `aria-invalid` | ring style, mono; no invalid look today |
| `DescriptionEditor.tsx:173` | 170–181 | textarea, `autoFocus`, callback `ref` | `bg-pane-panel p-3 text-base` |
| `MarkdownDocumentEditor.tsx:176` | 174–179 | textarea, `aria-label="Document source"` | `bg-pane-panel p-4 text-sm` |
| `OnboardingProviders.tsx:212` | 205–213 | checkbox, `aria-label="I use {provider}"` | native `accent-focus-accent` |

`SETTINGS_FIELD_CLASS` callers (8 files, matching the ticket's count): `features/settings/instant/InstantSettingsPanel.tsx:119–135` (textarea), `features/studio/modals/KeyboardSettingsPanel.tsx:198–205` (search input), `features/workflows/LaunchDefaultPicker.tsx:84,102,121,140` (4 selects), `features/workflows/StageSkillsField.tsx:48–61` (input), `features/workflows/ModelConfigurationPanel.tsx:360–366` (input), `features/workflows/IssueTypesSection.tsx:111–136` and `:434–445` (2 selects), `features/workflows/StateCatalog.tsx:203–209` (input) and `:213–222` (select), `features/workflows/LaunchConfigurationForm.tsx:111–119` (textarea).

`SETTINGS_CHECKBOX_CLASS` callers (4 files, 8 checkboxes): `features/workflows/StateLaunchConfiguration.tsx:58,74`, `features/workflows/TransitionDisclosure.tsx:74`, `features/workflows/StateConfigurationPanel.tsx:316,332,408,425`, `features/workflows/ModelConfigurationPanel.tsx:338`. With the onboarding checkbox that makes 9 checkboxes in 5 files, so the ticket's "more than one caller" condition holds and a `Checkbox` component is created (D-5).

Other native form elements found by grepping `<input`, `<textarea` and `<select` across `studio/src`, and why each stays untouched:

| File:line | Element | Reason left untouched |
| --- | --- | --- |
| `app/shell/ticket-workspace/tasks/components/IdeaEntry.tsx:129` | borderless textarea inside a focus-styled container | The container owns border and focus (`data-focused`); a field border would double it. Guarded by `src/test/IdeaEntryFocus.test.tsx`. |
| `features/conversations/composer/ConversationComposer.tsx:83` | borderless textarea inside an always-focused container | Same composite pattern as IdeaEntry. Only the composer's select (93) migrates. |
| `app/shell/ticket-workspace/tasks/components/StoriesSearchInput.tsx:33` | filled pane search with a leading icon and a clear button | Different control (filled, transparent border, icon padding). Follow-up candidate, not in the inventory. |
| `app/shell/ticket-workspace/selected-ticket/details/NameEditor.tsx:44` | inline title editor (`font-sans text-xl font-semibold`) | Heading typography in place of a title; no size in this API carries it. Follow-up candidate. |
| `features/workflows/StateCatalog.tsx:293` | `type="color"` swatch | Not a text field. |
| `features/workflows/StateCatalog.tsx:300` | borderless inline-rename input in a list row | Row-inline edit affordance (transparent until hover). Follow-up candidate. |
| `shared/ui/PopoverSearch.tsx:8` | popover search input | Owned by ticket 07 (D-9). |

### 3.4 Guard tests that read source or classes

- `src/test/overhaulTypographyReadabilityAcceptance.test.tsx:42` asserts, on the source text of `DescriptionEditor.tsx`, the regex `aria-label="Ticket description source"` followed later by `text-base`. After migration the class leaves that file, so this assertion changes deliberately (section 9.3). Line 41 (`cursor-text px-2 py-1.5 text-base`) still matches the untouched read-view div at `DescriptionEditor.tsx:119`.
- `src/test/overhaulSquareCornersAcceptance.test.tsx` scans all non-test source for `rounded*` utilities and radii. The new files must contain none.
- `src/app/__tests__/moduleBoundaries.test.ts`: shared code must not import upward; no export-star barrels.
- No existing test asserts the class strings of any migrated field (searched for `ring-pane-border`, `focus:border`, `focus:ring`, `accent-focus-accent`, `SETTINGS_FIELD`, `SETTINGS_CHECKBOX`, `border-focus-accent` across every `*.test.ts(x)`).

### 3.5 Preflight gates (stop instead of improvising)

- If any migrated element carries a prop not covered by the component's prop type (section 4), stop and extend the type deliberately rather than casting.
- If an implementer finds a caller that needs a colour, border, font or text-size override through `className`, stop: that is a missing size or a scope question, not a local styling choice.
- If ticket 07 has already changed `PopoverSearch` or ticket 08 has already replaced the `ModulePicker` or `MergeDestinationPicker` input, skip that row of the change map and record it in the PR. Do not re-introduce a raw input.

## 4. Component contracts

All four components are `forwardRef` function components with named exports, written as `forwardRef(function TextField(props, ref) …)` so React DevTools shows the name. Each renders exactly one native element with no wrapper, spreads every remaining prop onto it, and forwards `ref` to that element. None holds state, effects or context.

### 4.1 Shared style: `shared/ui/fieldStyle.ts`

Exports type `FieldSize` = `"xs" | "sm" | "md" | "lg"` and function `fieldClassName(options)`, where options is `{ size: FieldSize; mono?: boolean; className?: string }`. It returns the base classes, then the size classes, then `font-mono` when `mono` is true, then `className` when given, joined by single spaces with no trailing whitespace.

It is internal to `shared/ui`: only the three field components import it. Feature code never imports `fieldStyle.ts`; it renders a component.

Base classes (identical for TextField, TextArea, Select):

`min-w-0 border border-pane-border bg-pane-bg text-text-primary outline-none placeholder:text-text-muted focus:border-focus-accent disabled:cursor-not-allowed disabled:opacity-40 aria-[invalid=true]:border-lifecycle-danger aria-[invalid=true]:focus:border-lifecycle-danger`

The stacked `aria-[invalid=true]:focus:` utility has higher specificity than `focus:` and keeps an invalid field red while focused.

Size classes (constant record `FIELD_SIZE_CLASS`, keyed by `FieldSize`):

| Size | Classes | Used by |
| --- | --- | --- |
| `xs` | `px-2 py-1 text-xs` | compact inline controls (composer agent select, merge destination search) |
| `sm` | `px-2 py-1 text-sm` | dense pane and modal fields (child issues, parent filter, module search, add project/module, prompt, module folder) |
| `md` (default) | `px-3 py-2 text-sm` | settings forms and full-width modal fields (all `SETTINGS_FIELD_CLASS` callers, keyboard shortcuts filter, reassign select, document source) |
| `lg` | `px-3 py-2 text-base` | reading-size source editing (description source fallback) |

### 4.2 `TextField` (`shared/ui/TextField.tsx`)

| Prop | Type | Default | Behaviour |
| --- | --- | --- | --- |
| `size` | `FieldSize` | `"md"` | Density and text size (4.1). Replaces the native numeric `size` attribute, which is omitted from the type. |
| `mono` | `boolean` | `false` | Adds `font-mono` for path, key and command entry. |
| `type` | `"text" \| "search"` | unset (browser default `text`) | Closed. Checkboxes use `Checkbox`; colour swatches stay native. |
| `className` | `string` | none | Layout only (D-4). |
| ref | `Ref<HTMLInputElement>` | — | Forwarded to the `<input>`. |
| everything else | `Omit<InputHTMLAttributes<HTMLInputElement>, "size" \| "type" \| "className">` | — | Spread onto the `<input>` unchanged, including `role`, every `aria-*`, every `data-*`, `id`, handlers, `autoFocus`, `disabled`. |

Renders `<input>` with `className={fieldClassName({ size, mono, className })}`.

### 4.3 `TextArea` (`shared/ui/TextArea.tsx`)

| Prop | Type | Default | Behaviour |
| --- | --- | --- | --- |
| `size` | `FieldSize` | `"md"` | As TextField. |
| `mono` | `boolean` | `false` | As TextField. |
| `className` | `string` | none | Layout only (D-4); typically `w-full` and a `min-h-*`. |
| ref | `Ref<HTMLTextAreaElement>` | — | Forwarded to the `<textarea>`; object refs and callback refs both work. |
| everything else | `Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">` | — | Spread unchanged. |

Renders `<textarea>` with `fieldClassName(...)` plus `resize-y` (always vertical-only resize; every current textarea caller is either `resize-y` or unspecified).

### 4.4 `Select` (`shared/ui/Select.tsx`)

| Prop | Type | Default | Behaviour |
| --- | --- | --- | --- |
| `size` | `FieldSize` | `"md"` | As TextField. Native `size` omitted. |
| `className` | `string` | none | Layout only. |
| `children` | `ReactNode` | — | The `<option>` elements, rendered as given. |
| ref | `Ref<HTMLSelectElement>` | — | Forwarded to the `<select>`. |
| everything else | `Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" \| "multiple" \| "className">` | — | Spread unchanged. |

Native `<select>`, never a custom listbox (custom pickers are ticket 07/08). No `mono` prop: no caller needs one.

### 4.5 `Checkbox` (`shared/ui/Checkbox.tsx`)

| Prop | Type | Default | Behaviour |
| --- | --- | --- | --- |
| `className` | `string` | none | Layout only. |
| ref | `Ref<HTMLInputElement>` | — | Forwarded to the `<input type="checkbox">`. |
| everything else | `Omit<InputHTMLAttributes<HTMLInputElement>, "type" \| "size" \| "className">` | — | Spread unchanged (`checked`, `onChange`, `disabled`, `aria-label`, …). |

Renders `<input type="checkbox">` with exactly the current `SETTINGS_CHECKBOX_CLASS` string, moved verbatim into a module constant `CHECKBOX_CLASS` inside `Checkbox.tsx`:

`grid size-4 shrink-0 appearance-none place-content-center border border-pane-border bg-pane-bg before:size-2 before:scale-0 before:bg-pane-bg before:content-[''] checked:border-focus-accent checked:bg-focus-accent checked:before:scale-100 disabled:cursor-not-allowed disabled:opacity-40`

followed by `className` when given. The browser's default focus outline stays (no global rule removes it), so keyboard focus remains visible. No label prop: callers keep their wrapping `<label>` and text.

### 4.6 Labelling contract (D-1)

The components are bare controls. Accessible names come from the caller exactly as today: a wrapping `<label>`, a `<label htmlFor>` with `id`, or `aria-label`. No `label`, `hint` or `error` prop exists. This keeps every existing accessible name and layout unchanged and avoids a wrapper element (which would break the description editor's ref and blur constraints).

### 4.7 Error behaviour

The components have no failure modes of their own. Invalid state is expressed only by the caller's `aria-invalid`, which the style turns red. Error text remains the caller's (`role="alert"` paragraphs, `InlineError`, `SettingsStatusLine`), unchanged here.

## 5. Decisions

| ID | Decision | Reason |
| --- | --- | --- |
| D-1 | Bare controls; no built-in label, hint or error slot. | Every caller already labels its control in one of three ways; a slot would change layout and add a wrapper. |
| D-2 | One look, so no `variant` prop. Only `size` (and `mono`) vary. | The spec asks for "one border-plus-focus-border style"; a variant with one value is dead flexibility. |
| D-3 | `FieldSize` is `xs`, `sm`, `md`, `lg` with the classes in 4.1; default `md`. | These four cover every migrated element's density and text size with the smallest set; `md` is the most common (settings). |
| D-4 | `className` is layout only. Allowed: width (`w-*`, `min-w-*`, `max-w-*`), height (`min-h-*`, `h-*` on TextArea), margin (`m*-*`), flex and grid placement (`flex-1`, `block`, `self-*`), `pr-*` to reserve space for an overlaid glyph, and `uppercase` for case-normalised identifier entry. Anything else (colour, border, font, text size, other padding) is rejected in review. | Matches the spec's Variant API rule and the two existing needs (`MergeDestinationPicker`'s "▾", `AddProject`'s key). |
| D-5 | Create `Checkbox`; delete `SETTINGS_CHECKBOX_CLASS`. | 9 checkboxes in 5 files exceed the ticket's one-caller threshold. |
| D-6 | `fieldStyle.ts` is a separate module, internal to `shared/ui`. | Three components share one class contract; one file per concern, named by purpose. |
| D-7 | Description source textarea uses `size="lg"` (keeps 14px `text-base`); the typography guard's DescriptionEditor regex is updated deliberately and a new assertion pins `lg` to `text-base` in `fieldStyle.ts`. | Keeps overhaul-160's 14px rule true while moving the class out of the feature file. |
| D-8 | Inputs outside the ticket inventory (3.3 table) stay untouched. | Different control types or composite containers; migrating them is scope creep. |
| D-9 | `PopoverSearch` stays unchanged here. It should share the field style: ticket 07 re-expresses its inner `<input>` as `TextField size="sm" autoFocus className="w-full"` inside the existing `border-b p-1.5` wrapper. That moves its focus border from `text-muted` to `focus-accent`, its placeholder from `text-muted/70` to `text-muted` and its background from transparent to `pane-bg`. | Owner is ticket 07; one search style is spec story 8. |
| D-10 | No extraction from the three oversized files touched (`IssueTypesSection.tsx` 484 lines, `StateConfigurationPanel.tsx` 461, `ModelConfigurationPanel.tsx` 418). | The edit only swaps elements for components and makes each file shorter; it adds no responsibility. Splitting them is separate work. |
| D-11 | `forwardRef` (React 18), named exports, no new dependency, string joining instead of `clsx`. | Repository facts in 3.1. |

## 6. File and component change map

Paths are relative to `studio/src/`. "Visible change" lists the intended look differences only; behaviour is unchanged everywhere.

### 6.1 Created

| File | Responsibility | Not responsible for | Verification |
| --- | --- | --- | --- |
| `shared/ui/fieldStyle.ts` | `FieldSize`, `FIELD_SIZE_CLASS`, `fieldClassName`: the single field class contract (4.1). | Rendering; checkbox look; importing anything. | Typecheck; exercised through the component tests; typography guard pins `lg` (9.3). |
| `shared/ui/TextField.tsx` | `TextField`, `TextFieldProps` (4.2). | Labels, errors, adornments, combobox behaviour. | `TextField.test.tsx`. |
| `shared/ui/TextArea.tsx` | `TextArea`, `TextAreaProps` (4.3). | Autosize, rich editing. | `TextArea.test.tsx`. |
| `shared/ui/Select.tsx` | `Select`, `SelectProps` (4.4). | Custom listbox, searching. | `Select.test.tsx`. |
| `shared/ui/Checkbox.tsx` | `Checkbox`, `CheckboxProps`, private `CHECKBOX_CLASS` (4.5). | Label text, switches, tri-state. | `Checkbox.test.tsx`. |
| `shared/ui/TextField.test.tsx`, `TextArea.test.tsx`, `Select.test.tsx`, `Checkbox.test.tsx` | Behaviour tests (9.1). | Class-string assertions. | Run in the studio vitest suite. |

### 6.2 Modified — ticket instances

| File | Element (lines) | Becomes | Keep exactly | Visible change |
| --- | --- | --- | --- | --- |
| `app/shell/ticket-workspace/selected-ticket/details/ChildIssues.tsx` | select 62–73 | `Select size="sm"` | `value`, `onChange`, `aria-label="Child issue type"`, `data-testid="add-subtask-type"`, options | none |
| same | input 74–86 | `TextField size="sm" className="flex-1"` | `value`, `onChange`, `onKeyDown`, placeholder, `data-testid="add-subtask"` | none |
| `features/studio/modals/KeyboardShortcutsModal.tsx` | input 118–125 | `TextField type="search" className="w-full"` (size `md`) | `id="keyboard-shortcuts-filter"`, `value`, `onChange`, placeholder | none |
| `features/studio/modals/ParentUpdate.tsx` | input 125–134 | `TextField type="text" size="sm" className="mb-2 w-full"` | `value`, placeholder, `onChange` (resets cursor) | text becomes `text-sm`; placeholder becomes `text-muted` |
| `features/module-tabs/ModulePicker.tsx` | input 200–215 | `TextField ref={searchRef} type="search" size="sm" className="mb-1 w-full"` | `role="combobox"`, `aria-label`, `aria-expanded`, `aria-activedescendant`, `aria-controls`, `value`, `onChange`, placeholder | text 14px to 12.5px, matching `PopoverSearch` |
| `app/shell/DialogHost.tsx` | select 81–92 | `Select ref={selectRef} className="mt-2 block w-full"` (size `md`) | `value`, `onChange`, options, `initialFocusRef` wiring at 70 | focus border now visible (`focus-accent`) |
| `features/conversations/composer/ConversationComposer.tsx` | select 93–107 | `Select size="xs"` | `aria-label`, `value`, `onChange`, options | text colour `text-secondary` to `text-primary`; padding `px-1` to `px-2 py-1`; hover border dropped; focus border on `focus` not only `focus-visible` |
| `features/agents/worktrees/changes/MergeDestinationPicker.tsx` | input 48–89 | `TextField size="xs" className="w-full pr-6"` | every combobox attribute, `autoComplete="off"`, `disabled`, placeholder, `value`, all four handlers | gains `focus-accent` focus border (was the browser outline); disabled opacity 50 to 40 |
| `features/studio/modals/AddProject.tsx` | input 50–57 | `TextField mono size="sm" className="mt-1 w-full"` | `autoFocus`, `value`, `onChange`, placeholder, `spellCheck={false}` | ring to border |
| same | input 61–68 | `TextField mono size="sm" className="mt-1 w-full uppercase"` | `value`, `onChange`, `maxLength={3}`, placeholder, `spellCheck={false}` | ring to border |
| `features/studio/modals/AddModule.tsx` | input 176–187 | `TextField mono size="sm" className="mt-2 w-full"` | `id={moduleNameId}`, `data-coach-anchor="module-name"`, `aria-describedby`, `autoFocus`, `disabled`, `value`, `onChange`, placeholder, `spellCheck` | ring to border; text colour now explicit `text-primary` |
| `features/agents/terminal/PromptInput.tsx` | textarea 69–76 | `TextArea ref={textAreaRef} mono size="sm" rows={10} className="w-full"` | `value`, `onChange`, placeholder, `initialFocusRef={textAreaRef}` at 67 | ring to border; resize limited to vertical |
| `features/agents/terminal/ModuleFolderSelection.tsx` | input 102–114 | `TextField mono size="sm" className={pickerInline ? "flex-1" : "w-full"}` | `id`, `autoFocus`, `disabled`, `aria-label`, `aria-describedby`, `aria-invalid` expression, `value`, `onChange`, placeholder, `spellCheck` | ring to border; invalid path now shows a `lifecycle-danger` border |
| `features/documents/DescriptionEditor.tsx` | textarea 170–181 | `TextArea autoFocus mono size="lg" className="min-h-[12rem] w-full"` | `aria-label="Ticket description source"`, `value`, `onChange`, the callback `ref` body unchanged | background `pane-panel` to `pane-bg`; padding `p-3` to `px-3 py-2`. Constraints in section 8. |
| `features/documents/MarkdownDocumentEditor.tsx` | textarea 174–179 | `TextArea mono className="min-h-[60vh] w-full"` (size `md`) | `aria-label="Document source"`, `value`, `onChange` | background `pane-panel` to `pane-bg`; padding `p-4` to `px-3 py-2` |
| `app/onboarding/OnboardingProviders.tsx` | checkbox 205–213 | `Checkbox` | `aria-label`, `checked`, `disabled`, `onChange` | native accent checkbox to the square settings checkbox |

### 6.3 Modified — `SETTINGS_FIELD_CLASS` and `SETTINGS_CHECKBOX_CLASS` callers

Each file drops the constant from its `SettingsPrimitives` import (removing the import line if nothing else remains) and adds an import of the components it uses from `../../shared/ui/<Component>` (relative depth as for the existing `SettingsPrimitives` import). All are size `md` (default) unless stated. No visible change except the dropped focus ring.

| File | Elements | Becomes |
| --- | --- | --- |
| `features/settings/instant/InstantSettingsPanel.tsx` | textarea 119–135 | `TextArea ref={promptRef} mono className="w-full"`; keeps `aria-label`, `value`, `maxLength`, `disabled`, `onChange`, `rows={8}`, placeholder |
| `features/studio/modals/KeyboardSettingsPanel.tsx` | input 198–205 | `TextField id="binding-search" type="search" className="w-full"` |
| `features/workflows/LaunchDefaultPicker.tsx` | selects 84, 102, 121, 140 | `Select` ×4; keeps each `aria-label`, `value`, `disabled`, `onChange`, options |
| `features/workflows/StageSkillsField.tsx` | input 48–61 | `TextField`; keeps `id={inputId}`, `aria-label="Skills"`, placeholder, `value`, `onBlur`, `onChange`, `onKeyDown` |
| `features/workflows/ModelConfigurationPanel.tsx` | checkbox 338–346; input 360–366 | `Checkbox`; `TextField` (keeps `aria-label="New Codex profile"`, `value`, `disabled`, `onChange`) |
| `features/workflows/IssueTypesSection.tsx` | selects 111–136 and 434–445 | `Select`; `Select autoFocus className="min-w-44"` |
| `features/workflows/StateCatalog.tsx` | input 203–209; select 213–222 | `TextField autoFocus`; `Select` |
| `features/workflows/LaunchConfigurationForm.tsx` | textarea 111–119 | `TextArea className="w-full"`; keeps `aria-label="Prompt"`, `rows={promptRows}`, `onChange`, `onBlur`, placeholder |
| `features/workflows/StateLaunchConfiguration.tsx` | checkboxes 58, 74 | `Checkbox` ×2 |
| `features/workflows/TransitionDisclosure.tsx` | checkbox 74 | `Checkbox` |
| `features/workflows/StateConfigurationPanel.tsx` | checkboxes 316, 332, 408, 425 | `Checkbox` ×4 |

### 6.4 Modified — shared helper and guard

| File | Change | Verification |
| --- | --- | --- |
| `shared/ui/SettingsPrimitives.tsx` | Delete `SETTINGS_FIELD_CLASS` (lines 9–10) and `SETTINGS_CHECKBOX_CLASS` (12–13). Everything else stays (owned by tickets 05 and 10). | `npm run typecheck` fails if any import remains; grep in 9.4 returns nothing. |
| `src/test/overhaulTypographyReadabilityAcceptance.test.tsx` | Deliberate assertion change (9.3). | The test passes after step 5. |

### 6.5 Intentionally untouched

`shared/ui/PopoverSearch.tsx` (D-9), `shared/ui/Popover.tsx`, `IdeaEntry.tsx`, `StoriesSearchInput.tsx`, `NameEditor.tsx`, the ConversationComposer textarea, the two non-inventory `StateCatalog.tsx` inputs (293, 300), `studio/tailwind.config.ts`, `app/styles/*.css`, and `app/shell/ticket-workspace/selected-ticket/internal/useWorkspaceTabFocus.ts` (the focus fix from b47afeb0).

## 7. Runtime flows

These components add no runtime flow. Rendering is synchronous and stateless; focus, change and blur events flow from the native element straight to the caller's handlers, as before. The three flows that depend on element identity are:

1. Modal initial focus: `ModalShell` focuses `initialFocusRef.current` on mount. `DialogHost` (`selectRef`) and `PromptInput` (`textAreaRef`) pass object refs that `forwardRef` attaches to the native element before `ModalShell`'s effect runs, so the same element receives focus.
2. Combobox focus and keyboard: `ModulePicker` and `MergeDestinationPicker` attach handlers and ARIA to the input; the forwarded element is the same `<input>`, so `aria-activedescendant` and the key handlers behave identically.
3. Description source fallback: section 8.

## 8. Description editor focus-preservation constraints

Commit b47afeb0 ("preserve description focus") changed `useEditViewWorkspaceFocus` in `app/shell/ticket-workspace/selected-ticket/internal/useWorkspaceTabFocus.ts`: when the edit view enters the `active-tab-body` zone, it no longer pulls focus to the body if `bodyRef.current.contains(document.activeElement)`. It added `src/test/overhaulDescriptionFocusAcceptance.test.tsx`, which focuses an editor inside the body and asserts that it keeps focus and that the `s` key does not open Settings. The desktop script `studio/scripts/desktop-description-acceptance.mjs` asserts the rich editor keeps focus after a click.

The migration changes only the source-fallback `<textarea>` in `DescriptionEditor.tsx` (the rich editor path is untouched). To keep that behaviour, `TextArea` and its use must satisfy all of these:

1. The native `<textarea>` stays a DOM descendant of the `data-testid="issue-description"` div. `TextArea` renders no portal and no wrapper element, so the container's `onBlur` check (`event.currentTarget.contains(event.relatedTarget)`) and the workspace's `bodyRef.current.contains(document.activeElement)` check see the same element as today.
2. `TextArea` renders no focusable wrapper and calls no `focus()`, `blur()` or `preventDefault` itself, so it cannot move focus.
3. `autoFocus` passes straight to the native `<textarea>`. The fallback still focuses itself when it mounts after a parse error.
4. The callback `ref` keeps its current body and receives the native `HTMLTextAreaElement`: `element.disabled` is still readable and `taskDetailPoint(issueId)("description-editor-fallback-editable")` still fires when `detailsVisible` is true.
5. `TextArea` is a stable, module-level component. It is never defined inside `DescriptionEditor`, and the JSX element type at that position never changes between renders, so React never remounts the textarea while it is being typed into (a remount would drop focus and the caret).
6. The element stays a native `<textarea>`, so the global shortcut layer still treats it as an editable target and `s` and other single-key chords type text instead of firing commands.
7. `aria-label="Ticket description source"` stays on the element (used by `overhaulDescriptionAutosaveAcceptance`, `overhaulDescriptionSelectionAcceptance` and the typography guard).
8. The size stays 14px (`size="lg"`, D-7).

Verification: `overhaulDescriptionFocusAcceptance`, `overhaulDescriptionAutosaveAcceptance`, `overhaulDescriptionSelectionAcceptance`, `overhaulDescriptionExternalChangeAcceptance`, `overhaulDescriptionPreloadAcceptance`, `overhaulDescriptionRollbackReproduction` and the updated typography guard all pass unchanged (apart from 9.3). `TextArea.test.tsx` adds unit coverage for constraints 3 and 4 (callback ref receives the element; `autoFocus` focuses on mount).

## 9. Verification

### 9.1 New colocated tests (vitest, `@testing-library/react`, `fireEvent`)

They test roles, accessible names, state and callbacks only. They never assert class strings.

- `shared/ui/TextField.test.tsx`
  - Label association: inside a wrapping `<label>Name …</label>`, `getByLabelText("Name")` returns the `textbox`. With `<label htmlFor="f">` and `id="f"`, `getByRole("textbox", { name })` resolves.
  - `type="search"` renders role `searchbox`.
  - Change: `fireEvent.change` calls `onChange` with the new value.
  - Disabled: `disabled` gives `toBeDisabled()`.
  - Forwarded ref: a `createRef<HTMLInputElement>()` points at the element returned by `getByRole`; `ref.current.focus()` gives `toHaveFocus()`.
  - Invalid: `aria-invalid` true gives `toBeInvalid()`; omitted gives `toBeValid()`.
  - Hooks: `data-testid` and `role="combobox"` with `aria-expanded` pass through (`getByTestId`, `getByRole("combobox")`).
- `shared/ui/TextArea.test.tsx`: label association; change; disabled; object ref and callback ref both receive the `HTMLTextAreaElement`; `autoFocus` gives `toHaveFocus()` after render; `aria-invalid` gives `toBeInvalid()`.
- `shared/ui/Select.test.tsx`: label association (`getByLabelText` returns the `combobox`); change selects the option and calls `onChange`; disabled; forwarded ref; `aria-invalid` gives `toBeInvalid()`.
- `shared/ui/Checkbox.test.tsx`: named by `aria-label` and by a wrapping label (`getByRole("checkbox", { name })`); click calls `onChange` and the controlled `checked` state shows `toBeChecked()`; disabled gives `toBeDisabled()`; forwarded ref.

### 9.2 Existing suites that must stay green unchanged

- Settings and workflows: `overhaulWorkflowSettingsAcceptance`, `overhaulWorkflowStageSkillsAcceptance`, `overhaulWorkflowStageSkillSerializationAcceptance`, `overhaulCodexProfilesAcceptance`, `overhaulProviderSettingsAcceptance`, `overhaulProviderCatalogRuntimeAcceptance`, `overhaulInstantSettingsAcceptance`, `overhaulInstantTicketsAcceptance`, `overhaulLaunchBindingModelIdentityAcceptance`, `overhaulLaunchBindingRuntimeAcceptance`, `overhaulLaunchConfigurationConvergenceAcceptance`, `overhaulSubtreeRunAcceptance`, `overhaulRunNowAcceptance`, `overhaulStoryWorkflowGuideAcceptance`, `overhaulTaskAgentLaunchAcceptance`, `overhaulZeroProviderPlanningAcceptance`, `overhaulKeybindingSettingsRuntimeAcceptance`, `overhaulSettingsAcceptance`, `src/test/LaunchConfigurationForm.test.tsx`.
- Onboarding and modals: `overhaulOnboardingAcceptance`, `overhaulOnboardingCompletionAcceptance`, `overhaulOnboardingModuleAcceptance`, `CoachMark.test.tsx`, `overhaulModuleCreationAcceptance`, `overhaulModuleFolderAcceptance`, `overhaulProjectOnboardingAcceptance`, `overhaulDialogAcceptance`, `singleModalHost.test.tsx`.
- Pickers and panes: `overhaulModulePickerAcceptance`, `overhaulTaskWorktreeChangesAcceptance`, `overhaulConversationComposerAcceptance`, `overhaulWorkItemAcceptance`, `overhaulChangesKeymapScopeAcceptance`.
- Documents and description: `overhaulDocumentPersistenceAcceptance`, `overhaulDocumentSaveRuntimeAcceptance`, `overhaulRichMarkdownTabAcceptance`, and the description suites listed in section 8.
- Source scanners: `overhaulSquareCornersAcceptance`, `app/__tests__/moduleBoundaries.test.ts`.

### 9.3 Deliberate assertion change

In `src/test/overhaulTypographyReadabilityAcceptance.test.tsx`:

- Add `src/shared/ui/fieldStyle.ts` to the `Promise.all` file reads (bound as `fieldStyle`).
- Replace line 42's regex `aria-label="Ticket description source"[\s\S]*?text-base` with `aria-label="Ticket description source"[\s\S]*?size="lg"`.
- Add an assertion that `fieldStyle` matches `lg:\s*"[^"]*\btext-base\b`.
- Line 41 and every other assertion stay as they are.

This keeps overhaul-160 ("story descriptions at the terminal's 14px size") enforced for the source fallback through the shared size contract.

### 9.4 Commands and sweeps

From the repository root: `npm run typecheck`, `npm run test --workspace @worktracker/studio`, `npm run test:overhaul --workspace @worktracker/studio`, `npm run build --workspace @worktracker/studio`.

Source sweeps over `studio/src`, each expected to return nothing:

- `SETTINGS_FIELD_CLASS|SETTINGS_CHECKBOX_CLASS`
- `ring-1 ring-pane-border`
- `focus:border-accent-primary`
- `accent-focus-accent`
- `<select` outside `shared/ui/Select.tsx`
- `<textarea` outside `shared/ui/TextArea.tsx`, except `IdeaEntry.tsx` and `ConversationComposer.tsx`
- `<input`, except `shared/ui/TextField.tsx`, `shared/ui/Checkbox.tsx`, `shared/ui/PopoverSearch.tsx`, `StoriesSearchInput.tsx`, `NameEditor.tsx`, the two `StateCatalog.tsx` row inputs and test files

### 9.5 Manual check

Run `npm run web` and look at one field per size in both dark (default) and light themes, if a light theme is active: a settings form (`md`), Add Project (`sm`, mono), the conversation composer select (`xs`), and a description with forced source fallback (`lg`). Tab into each: the border turns `focus-accent` and there is no ring. Enter a relative path in the module folder field: the border turns `lifecycle-danger`.

## 10. Ordered implementation plan

1. **Components.** Create `fieldStyle.ts`, `TextField.tsx`, `TextArea.tsx`, `Select.tsx`, `Checkbox.tsx` and their four tests. Depends on nothing. Gate: the four new test files pass; `npm run typecheck`. Touch no caller yet.
2. **Settings callers and checkbox.** Migrate the 8 `SETTINGS_FIELD_CLASS` files, the 4 `SETTINGS_CHECKBOX_CLASS` files and `OnboardingProviders.tsx` (6.3, plus the onboarding row of 6.2). Then delete both constants from `SettingsPrimitives.tsx`. Depends on 1. Gate: typecheck (proves no remaining import), the settings, workflows and onboarding suites in 9.2.
3. **Modal and ring-style fields.** `AddProject.tsx`, `AddModule.tsx`, `PromptInput.tsx`, `ModuleFolderSelection.tsx`, `DialogHost.tsx`, `KeyboardShortcutsModal.tsx`, `ParentUpdate.tsx`. Depends on 1. Gate: onboarding and modal suites, `overhaulModuleFolderAcceptance`, `overhaulDialogAcceptance`.
4. **Pane and picker fields.** `ChildIssues.tsx`, `ConversationComposer.tsx`, `ModulePicker.tsx`, `MergeDestinationPicker.tsx`. Depends on 1. Gate: picker and pane suites in 9.2.
5. **Document textareas.** `DescriptionEditor.tsx`, `MarkdownDocumentEditor.tsx`, and the typography assertion change (9.3) in the same commit. Depends on 1. Gate: every description and document suite in section 8 and 9.2, and the typography guard.
6. **Close-out.** Run the sweeps and all four commands in 9.4, then the manual check in 9.5. Gate: all green, all sweeps empty.

Steps 2 to 5 are independent of each other once step 1 lands and may be separate commits. Constants are deleted only at the end of step 2, after their last caller has moved (expand then contract).

## 11. Coordination with sibling tickets

- **05 (Button):** edits buttons in `DialogHost.tsx`, `AddProject.tsx`, `AddModule.tsx`, `PromptInput.tsx`, `StateCatalog.tsx`, `IssueTypesSection.tsx` and deletes `settingsButtonClass`. 06 does not touch those buttons. If both are in flight, the conflicts are textual only.
- **07 (Menu/Listbox):** owns `PopoverSearch` (D-9). Whichever of 06 and 07 lands second rebases; 07 adopts `TextField` once 06 has landed.
- **08 (Search pickers):** rewrites `ModulePicker` and `MergeDestinationPicker`. 06 migrates only their single input element. 08 either keeps that `TextField` or replaces it with `PopoverSearch`, which will render `TextField` after 07. Either way the field style is preserved.
- **10 (Headings and placeholders):** owns the `text-red-400` error lines and eyebrows next to migrated fields (`AddProject`, `AddModule`, `PromptInput`, `ModuleFolderSelection`). 06 leaves them.
- **01 (CloseButton):** owns the "×" in `StageSkillsField.tsx:37–44`. 06 changes only the input at 48–61.
- **09 (Modals):** owns the `StateCatalog` delete confirm (120–127). 06 changes only 203–222.

## 12. Acceptance mapping

| ID | Criterion (ticket and spec) | Steps | Verification |
| --- | --- | --- | --- |
| AC-1 | Components exist with tests for label association, disabled, forwarded ref and `aria-invalid` | 1 | The four colocated test files in 9.1 |
| AC-2 | Every ticket instance migrated; `SETTINGS_FIELD_CLASS` deleted; checkboxes use `Checkbox` and `SETTINGS_CHECKBOX_CLASS` is deleted | 2–5 | Typecheck; sweeps in 9.4 |
| AC-3 | Description editor focus behaviour unchanged (b47afeb0) | 5 | Section 8 suites; `TextArea.test.tsx` ref and autoFocus cases |
| AC-4 | Typecheck, studio tests and `test:overhaul` pass | 6 | Commands in 9.4 (plus build) |
| AC-5 | One border plus focus-border style on theme tokens; no ring style; no off-token focus colour (stories 15, 25) | 1–5 | `fieldStyle.ts` is the only field class source; sweeps for `ring-1 ring-pane-border` and `focus:border-accent-primary`; manual check 9.5 |
| AC-6 | Existing `data-testid`, `data-*`, `id` and ARIA hooks kept (story 37) | 2–5 | Change map "Keep exactly" column; unchanged suites in 9.2 |
| AC-7 | `className` used for layout only (spec Variant API) | 2–5 | Review against D-4's allowlist |

## 13. Remaining decisions and dependencies

No material decision is open. Two follow-ups are recorded but not decided here, because they are outside this ticket's inventory:

- Whether `NameEditor`, `StoriesSearchInput` and the `StateCatalog` inline-rename input should join the field style (each would need a size or variant this API does not have).
- `PopoverSearch` adoption, which is ticket 07's (D-9).
