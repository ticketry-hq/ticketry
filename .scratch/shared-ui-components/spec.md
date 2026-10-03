# Shared UI component library for Studio

Status: ready-for-agent
Type: Story
Scope: Ticketry Studio frontend (`studio/src`) only. The roadmap planner is out of scope.

## Problem Statement

Ticketry is about to grow well beyond work-item planning, so the same UI pieces will be needed in many more places. Today almost every common piece is hand-built in each place that uses it:

- Seven tab or segmented-control strips, each with its own selected style. The header module tabs hard-code an accent hex colour.
- Six dropdown and menu re-implementations that bypass the shared `Popover`.
- About 30 hand-styled buttons, split across three separate button systems.
- Three text-input styles.
- Modals that copy `ModalShell`'s focus trap or skip it entirely. Two confirm dialogs ignore Escape and focus.
- 39 uppercase headings in four variants.
- About 30 empty states, about 20 loading lines and about 25 error lines, using three different reds.
- 17 status dots, five drag-and-drop seams and nine "×" buttons.

Where a shared piece already exists (`PopoverOption`, `PopoverSearch`, `ModalShell`, `ConfirmDialog`, `settingsButtonClass`, `SETTINGS_FIELD_CLASS`, `KeyChordHint`, `useGlobalShortcutLabel`), most callers do not use it.

For the person using the app, this shows up as:

- tabs, menus and buttons that look and behave slightly differently in each pane;
- menus that do not all close on Escape or support the arrow keys;
- dialogs that let focus escape.

For the people building Ticketry, every new feature copies the nearest class string, so the inconsistency grows with each feature.

## Solution

A small set of shared, accessible UI components in `studio/src/shared/ui/`, plus work-item display components in `studio/src/features/work-items/`. Every existing duplicate moves onto them, so each pattern has exactly one implementation. Where several things share a role (tabs, menus, buttons, inputs, dialogs, placeholders), they then look, respond to the keyboard and handle focus the same way everywhere. New features compose these components instead of copying markup.

## User Stories

1. As a Studio user, I want every tab strip to show the selected tab the same way, so that I can tell where I am at a glance in any pane.
2. As a Studio user, I want the header module tabs, workspace tabs and shell tabs to close with the same "×" in the same position, so that closing a tab is muscle memory.
3. As a Studio user, I want arrow keys to move between tabs in any tab strip, so that I can navigate without the mouse.
4. As a Studio user, I want the selected tab in an overflowing strip to scroll into view, so that I never lose the active tab off-screen.
5. As a Studio user, I want the drag-and-drop insertion line to look identical when reordering tabs, modules, stories or states, so that I recognise a drop target immediately.
6. As a Studio user, I want every dropdown menu to close on Escape and on clicking outside, so that menus never get stuck open.
7. As a Studio user, I want arrow keys, Home/End and Enter to work in every picker list, so that keyboard selection is consistent.
8. As a Studio user, I want every searchable picker (module picker, worktree switcher, merge destination, parent, blocker) to filter as I type with the same search field, so that search behaves predictably.
9. As a Studio user, I want the highlighted option in any menu to look the same, so that I know which item Enter will pick.
10. As a Studio user, I want menus to reposition when the window scrolls or resizes and to flip when there is no room below, so that they never render off-screen.
11. As a Studio user, I want primary, secondary and destructive buttons to look the same everywhere, so that I can tell the consequence of a click before I click.
12. As a Studio user, I want every dialog footer to put Cancel and the confirm action in the same order, so that I don't confirm by accident.
13. As a Studio user, I want every confirm dialog to trap focus, close on Escape and return focus to where I was, so that keyboard use is safe.
14. As a Studio user, I want Settings and the full-pane configuration overlays to behave like the other modals, so that focus and Escape work there too.
15. As a Studio user, I want text inputs and selects to share one border and focus style, so that I can always see which field has focus.
16. As a Studio user, I want section headings in detail panes, modals, settings and popovers to share one style, so that the information hierarchy reads consistently.
17. As a Studio user, I want empty states to look and read alike ("No matches", "No sub-tasks yet"), so that "nothing here" is never mistaken for a broken pane.
18. As a Studio user, I want loading indicators to be announced to assistive technology and to use consistent wording, so that I know something is in progress.
19. As a Studio user, I want every error message to use the same danger colour and to be announced as an alert, so that errors stand out.
20. As a Studio user, I want status dots and chips (workflow state, worktree checkout, PR state, lifecycle) to use one size and one colour mapping per status, so that colour always carries the same meaning.
21. As a Studio user, I want a work item shown in child issues, findings and pickers to look the same (key, name, state), so that I recognise an issue wherever it appears.
22. As a Studio user, I want every "×" close button to have the same hit area and an accessible label, so that it is easy to hit and screen readers announce it.
23. As a Studio user, I want keyboard-shortcut hints to render the same way everywhere, so that I can learn shortcuts from the UI.
24. As a Studio user, I want footer bar buttons to share one style, so that the footer reads as one toolbar.
25. As a Studio user on light or dark theme, I want every component to use theme tokens rather than hard-coded colours, so that nothing looks wrong when the theme changes.
26. As a Ticketry developer, I want one `TabStrip` that supports closable, draggable, underline, boxed, pill and vertical-rail tabs, so that a new tabbed view takes one import.
27. As a Ticketry developer, I want one `Button` with a small, closed set of variants and sizes, so that I never copy a class string again.
28. As a Ticketry developer, I want `Menu` and `Listbox` built on the existing `Popover`, sharing one keyboard-navigation hook, so that positioning, dismissal and keyboard behaviour live in one place.
29. As a Ticketry developer, I want `TextField` and `Select` that replace `SETTINGS_FIELD_CLASS` and the ring and border variants, so that form styling has one source.
30. As a Ticketry developer, I want `SectionHeading`, `EmptyState`, `LoadingState` and `ErrorLine` components, so that placeholders and headings stop drifting.
31. As a Ticketry developer, I want `StatusDot` and `Chip`, and one shared colour mapping for statuses, so that adding a new status means adding one entry.
32. As a Ticketry developer, I want `WorkItemKey` and `WorkItemListRow` in the work-items feature, so that every feature listing work items renders them the same way.
33. As a Ticketry developer, I want `DropSeam` and `CloseButton`, so that drag-and-drop and close affordances are one import.
34. As a Ticketry developer, I want each superseded helper (`settingsButtonClass`, `SETTINGS_FIELD_CLASS`, `SETTINGS_EYEBROW_CLASS`, the `DialogHost` button classes, private `Dot`/`Identifier`/`GroupHeading` components) deleted once no caller remains, so that there is only one way to do it.
35. As a Ticketry developer, I want each component covered by a behaviour test (role, keyboard, selected and disabled state), so that I can change a component without re-testing every screen by hand.
36. As a Ticketry reviewer, I want each migration to land with the existing acceptance suites green, so that the consolidation never changes behaviour unnoticed.
37. As a Ticketry developer, I want the components to keep stable `data-*` and `data-testid` hooks that existing tests use, so that the migration does not churn the test suite.
38. As a Ticketry developer building a new domain (the roadmap's planner, monitoring and others), I want a short list of available components in `shared/ui`, so that I know what exists before writing markup.

## Implementation Decisions

- **Location.** Cross-feature components go in `shared/ui/`, one component per file, named by purpose. Work-item display components (`WorkItemKey`, `WorkItemListRow`) go in the work-items feature, exported from that feature's index. No new top-level folder, no component library package, no Storybook.
- **Styling.** Tailwind classes on existing theme tokens: `pane-*`, `text-*`, `focus-accent`, `selection-bg`, `lifecycle-*`. Hard-coded hex values (the `#7aa2f7` tab underline) and off-token colours (`text-red-400`, `bg-white/10`, `bg-accent-primary` in `DialogHost`) are replaced by tokens. Where a token is missing (for example a box-shadow underline using the focus accent), add it to the Tailwind config rather than inlining the hex.
- **Variant API.** Each component takes a closed, typed `variant` and `size` union, not free-form class names. `className` is accepted only for layout (margins, flex placement), never to restyle the variant.
- **TabStrip and Tab.**
  - Variants: `underline` (header module tabs and the footer toggle), `boxed` (workspace tabs), `plain` (shell tabs), `pill` (workflows), `rail` (vertical Settings rail).
  - ARIA: `role="tablist"` with `role="tab"` / `aria-selected`, and roving tabindex with arrow keys (Left/Right, or Up/Down for `rail`).
  - Behaviour: scrolls the active tab into view, and supports an optional close button per tab and leading or trailing slots (pane toggle, "+" picker).
  - Drag and drop stays on the existing `useAxisDragAndDrop` drag-source props, passed through per tab. The seam renders with `DropSeam`.
  - A pressed toggle that is visually a tab but is not part of a tab list (`FooterChangesToggle`) uses the `underline` styling exported as a tab-look button, keeping `aria-pressed`.
- **Button.**
  - Variants: `primary` (accent border), `secondary` (pane border with hover), `danger`, `ghost`, `icon`, `dashed` (add or launch triggers).
  - Sizes: `sm` (the h-7 action buttons), `md`.
  - `settingsButtonClass` and the `DialogHost` button classes are re-expressed through `Button`, then deleted.
  - A `DialogFooter` layout component renders Cancel before the confirm action, right-aligned.
- **Menu and Listbox.**
  - Both compose the existing `Popover` (anchoring, portal, scroll/resize tracking, outside dismiss), which gains Escape dismissal and flip-when-no-room-below if it lacks them.
  - `Menu` is `role="menu"`/`menuitem` for action menus. `Listbox` is `role="listbox"`/`option` with `aria-selected` and `aria-activedescendant` for pickers.
  - One shared keyboard-navigation hook handles Up/Down, Home/End, Enter and type-to-filter, and replaces the three hand-written loops.
  - `PopoverOption` becomes the single option row, with one size and one active style. `PopoverSearch` is the single search input.
- **TextField and Select.** One border-plus-focus-border style replaces the ring style and `SETTINGS_FIELD_CLASS`. A `mono` prop covers the path and command inputs that are monospace today. The textarea editors share one `TextArea`.
- **Headings and placeholders.**
  - `SectionHeading` has three levels: `eyebrow` (uppercase, tracking-wider), `section` (label plus optional count, used by child issues, attachments and findings) and `title` (`text-base font-semibold`).
  - `EmptyState` has two variants: `inline` for list or popover rows and `pane` for centred full-pane placeholders.
  - `LoadingState` always sets `role="status"` and uses "…".
  - `ErrorLine` always sets `role="alert"` and uses `lifecycle-danger`. It replaces `SettingsStatusLine`'s error tone or is built from it; the LLD decides which.
- **Status display.** `StatusDot` (one size, colour from a token class or a workflow-state colour) and `Chip` (bordered mono chip with optional dot, a removable variant and a count variant). The four overlapping colour mappings for statuses in the worktrees feature collapse into one exported mapping.
- **Work-item display.** `WorkItemKey` wraps `formatWorkItemDisplayIdentifier` with the shared key style, optionally coloured by state. `WorkItemListRow` shows dot, key, name and a trailing slot. The Stories-pane tree row (`PlanningRowView`) keeps its own row but uses `WorkItemKey` in `WorkItemRowLabel`.
- **Modals.**
  - `SettingsFrame` is rebuilt on `ModalShell` (no copied focus trap).
  - The `StateCatalog` delete confirm and `WorkflowImpactDialog` use `ConfirmDialog`, or `ModalShell` if they need custom bodies.
  - The two identical full-pane configuration overlays share one `PaneOverlay` component with eyebrow, title and `CloseButton`.
- **Small adoptions.** `ModulesPaneToggle` uses `useGlobalShortcutLabel`. `ConversationRows` and `ModuleJumpBadge` use `KeyBadge`. Footer bar buttons use `Button` variant `ghost`.
- **Migration strategy (expand–contract).** Each ticket adds its component next to the old markup, migrates the callers it lists, and deletes the replaced helpers or private components in the same ticket once no caller remains. Existing `data-testid` and `data-*` hooks are kept on the migrated elements.
- **Prototype code** under the conversations prototype folder is migrated only where it is a trivial swap. It is not a gate for any ticket.

## Testing Decisions

- A good test drives a component through its public behaviour: roles, accessible names, keyboard interaction, selected/disabled/pressed state and callbacks. It never asserts class strings or DOM structure beyond roles.
- Each new `shared/ui` component gets one React Testing Library test file next to it (vitest), covering at least:
  - `TabStrip`: arrow-key roving and selection.
  - `Menu` and `Listbox`: Escape, outside click, arrow, Home/End and Enter navigation.
  - `Button`: variant semantics such as disabled.
  - `CloseButton`: accessible label.
  - `LoadingState` and `ErrorLine`: `status` and `alert` roles.
- The keyboard-navigation hook is tested through `Listbox`, not on its own.
- Migrations are guarded by the existing suites, which must stay green unchanged: `npm run test:overhaul` (`src/test/overhaul*Acceptance.test.tsx`), the full `npm run test --workspace @worktracker/studio`, and `npm run typecheck`. Where a migration intentionally changes an assertion (for example the header tab underline is now a token class), the ticket says so explicitly.
- Prior art: `src/test/overhaulEditViewNavigationAcceptance.test.tsx`, `overhaulStoryReorderAcceptance.test.tsx` and `overhaulTerminalNavigationAcceptance.test.tsx` for behaviour-level tests; the existing `shared/ui/Popover` usage in the field pickers for component composition.

## Out of Scope

- The roadmap planner app and transplanting components into it.
- A design-token overhaul or theme redesign. Only missing tokens needed to remove hard-coded colours are added.
- Storybook, visual regression tooling, or a separately published package.
- Changing what any screen does. Only what is shown and how it responds to the keyboard and focus are unified.
- Rewriting `PlanningRowView` or the Stories tree.
- Animation, skeleton loaders and context menus (none exist today).

## Further Notes

- The inventory behind this spec, with every instance by file and line, is captured in each ticket's "Instances" list.
- Recommended order: 01 → 02 → (03, 04) in parallel; 05, 06, 07, 10 and 11 can start immediately; 08 after 07; 09 after 01 and 05; 12 after 11.
- These files live in the local tracker (`.scratch/shared-ui-components/`) because this session could not open Ticketry's MCP bridge. A Ticketry-launched agent should create one Story from this spec and one Implementation child per `issues/` file, keep the blocking edges, then move each `issues/NN-*/LLD.md` and `LLD.html` pair into that task's canonical `spec/<module>--<id8>/T<sequence>--<slug>/` directory.
