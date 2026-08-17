# WorkTracker Studio: current keyboard navigation

This is a factual reference for the implemented Studio navigation model. Source
paths are relative to `studio/`.

## View modes

Studio has two keyboard-navigation models, selected by sidebar visibility.

- **Full sidebar view** renders Projects, Modules, Stories, and the active Task
  workspace. It keeps pane-focus navigation and the existing workspace and
  live-terminal Command shortcuts.
- **Edit view** is active when the sidebar is hidden. It renders Stories beside
  the Task workspace and replaces pane traversal with three navigation zones.

`\` toggles the sidebar. The current view mode is stored in
`localStorage["studio.sidebarVisible:v1"]`; the legacy
`plane-tui:sidebar-visible` key is migrated on read. Entering edit view always
starts in its Stories zone rather than restoring a previously focused zone
(`src/state/clientStore.ts`, `src/state/persistence.ts`).

## Edit view

### Navigation mode and zones

Edit view starts in **navigation mode**, where Studio owns the navigation keys.
It has three zones, plus a fourth that exists only while the terminal panel is
showing:

1. **Z1 — Stories** (`stories`)
2. **Z2 — tab strip** (`tab-strip`)
3. **Z3 — active body** (`active-tab-body`)
4. **Z4 — terminal panel** (`terminal-panel`), present only while the panel is
   open (`src/features/terminal-panel/panelStore.ts`)

`Shift+Tab` moves forward through Z1 → Z2 → Z3 → Z1 and wraps, and through
Z1 → Z2 → Z3 → Z4 → Z1 while the panel is open. Studio prevents
the browser's native reverse-tab behavior. Moving from Z1 to Z2 initializes the
tab-strip highlight from the selected ticket's active tab
(`src/app/navigation/three-zone/threeZoneNavigation.ts`,
`src/app/shell/ticket-workspace/selected-ticket/SelectedTicketContent.tsx`).

The active zone receives the edit-view navigation emphasis. Mouse or focus
entry updates the zone consistently
(`src/app/shell/PaneShell.tsx`,
`src/app/shell/ticket-workspace/selected-ticket/internal/useWorkspaceTabFocus.ts`).

### Zone-local keys

| Zone | Key | Current effect |
|---|---|---|
| Z1 Stories | `ArrowUp` / `ArrowDown` | Move through visible Story rows and clamp. From no selection, Down selects the first and Up selects the last. Up from the first Story focuses Capture an idea. |
| Z1 Stories | `ArrowLeft` | Collapse the selected Story when it has expanded children; otherwise no-op. It never changes zones or panes. |
| Z1 Stories | `ArrowRight` | Expand the selected Story when it has collapsed children. When there is nothing left to expand, dive into that ticket's remembered active body in Z3 — the same destination and focus as `Enter`. It never stops at the Z2 tab strip. |
| Z1 Stories | `Enter` | Commit the selected ticket and dive directly into that ticket's remembered active body in Z3. |
| Z2 tab strip | `ArrowLeft` / `ArrowRight` | Move the highlight through Details → open documents → open terminals and clamp at both ends. Highlighting alone does not activate a tab. |
| Z2 tab strip | `Enter` | Commit the highlighted tab, make it active, and dive into its body in Z3. |
| Z3 active body | `ArrowUp` | Leave the body and make the Z2 tab strip the focused zone. |
| Z3 active body | `ArrowLeft` | Leave the body and make Z1 Stories the focused zone. |
| Z3 active body | `Enter` | Engage the active body. On a live terminal this explicitly enters terminal typing mode; Details and documents receive their normal controlled focus. |
| Z4 terminal panel | (on arrival) | Entering the zone commits to terminal typing mode in the panel's shell — the panel holds nothing else. |
| Z4 terminal panel | `ArrowUp` | Leave the panel and make Z3 the focused zone. |
| Z4 terminal panel | `ArrowLeft` | Leave the panel and make Z1 Stories the focused zone. |
| Z4 terminal panel | `Enter` | Return to typing in the shell after `Cmd+Escape` left it. |

Arrows are zone-local in edit view apart from the routes that leave a zone
outright: Z1 `ArrowRight` dives Z1 → Z3 once the selected Story has nothing left
to expand, and from Z3 `ArrowUp` goes back to Z2 while `ArrowLeft` goes back to
Z1. Otherwise arrows do not move between panes, and Z2 does not wrap.
`Enter` remains the **commit-and-dive** gesture from Z1 and Z2; merely reaching
a terminal body does not focus xterm or start typing
(`src/app/navigation/three-zone/threeZoneNavigation.ts`,
`src/app/shell/ticket-workspace/selected-ticket/internal/useTaskWorkspaceTabNavigation.ts`).

### Terminal typing mode

A live terminal in Z3 remains in navigation mode until the user explicitly
presses `Enter`. Once xterm has focus, Studio treats it as **terminal typing
mode**:

- `Cmd+Escape` leaves typing mode and returns to the un-engaged active tab body
  — Z3 stays the focused zone. `ArrowLeft` from there then returns to Z1
  Stories.
- `Ctrl+\`` (panel toggle) and `Cmd+E` (Settings) are the other chords Studio
  intercepts: both work from typing mode too. On the desktop build's native
  renderer the terminal view owns the keyboard outright, so it recognises those
  chords itself, hands focus back to the WebView, and reports each one to
  Studio, where the chord's ordinary binding still owns what it does
  (`src-tauri/native/libghostty_view.m`,
  `src/app/navigation/nativeTerminalChords.ts`).
- The terminal panel's shell engages the same way, so `Cmd+Escape` leaves its
  typing too. The panel stays open and Z4 stays the focused zone; closing the
  panel remains `Ctrl+\``'s job, which also hands the zone back to Z3.
- `Tab`, `Shift+Tab`, `Enter`, arrows, and all other terminal input pass through
  to xterm/the agent unchanged.

This exception is resolved before the ordinary Studio keymap, but after modal
suppression (`src/app/navigation/useGlobalKeymap.ts`).

### Retired edit-view shortcuts

The following shortcuts are intentionally inactive in edit view:

- `Cmd+ArrowLeft` / `Cmd+ArrowRight`: Z2 Left/Right now highlights workspace
  tabs.
- `Cmd+\` / `Cmd+Shift+\`: selecting a Story and pressing Enter now reaches
  that ticket's remembered body.

They remain active in the full sidebar view
(`src/app/navigation/full-sidebar-view/fullSidebarViewNavigation.ts`,
`src/app/shell/ticket-workspace/selected-ticket/internal/useTaskWorkspaceTabNavigation.ts`).

## Full sidebar view

The logical pane order is Projects → Modules → Stories → Task workspace.
`ArrowLeft` / `h` and `ArrowRight` / `l` move pane focus without wrapping after
the focused pane declines the key. Projects and Modules Up/Down cursors clamp;
Stories Up/Down selection clamps, while Stories Left/Right first performs tree
collapse, expansion, or parent/child movement where applicable
(`src/app/navigation/full-sidebar-view/fullSidebarViewNavigation.ts`,
`src/state/clientStore.ts`).

Within the focused Task workspace:

- `Cmd+ArrowLeft` / `Cmd+ArrowRight` activate the previous/next tab in Details
  → open documents → open terminals order and clamp.
- `Cmd+\` / `Cmd+Shift+\` cycle forward/backward through live terminals and
  wrap.

In the full sidebar view and edit-view navigation mode, the registered global
actions remain available: `/` focuses Stories search; `o`, `n`, `i`, `s`, `w`,
`f`, `q`, and `e` invoke their displayed Studio actions; `Shift+Enter` opens
the selected ticket with a prompt (`src/app/navigation/keymapBindings.ts`,
`src/app/navigation/full-sidebar-view/fullSidebarViewNavigation.ts`).

## Precedence and editable surfaces

Open shared or legacy modals take precedence over both view models. Shared
modals own Escape and trap Tab/Shift+Tab. Outside terminal typing mode, ordinary
Studio shortcuts ignore input, textarea, select, contenteditable, and
already-prevented events. Local controls such as Stories search, Capture an
idea, and launcher menus keep their component-level key handling
(`src/app/navigation/useGlobalKeymap.ts`, `src/app/modal/ModalShell.tsx`).

Key resolution uses the central registry and its capture, focused-pane, global,
and modal contexts (`src/app/navigation/keymapRegistry.ts`,
`src/app/navigation/keymapBindings.ts`).

## Selection, tab memory, and routing

Studio mounts without a router (`src/main.tsx`). Ticket links inside child
issues, blockers, and findings call the client store's in-app selection action;
they do not navigate a URL or require a route
(`src/app/shell/ticket-workspace/selected-ticket/details/ChildIssues.tsx`,
`src/app/shell/ticket-workspace/selected-ticket/details/BlockerChipView.tsx`,
`src/app/shell/ticket-workspace/selected-ticket/details/FindingsPanel.tsx`).

The client persists:

| State | Current key | Identity stored |
|---|---|---|
| View mode | `studio.sidebarVisible:v1` | Sidebar shown/hidden |
| Selected ticket | `studio.selectedTaskByModule:v1` | Ticket ID by module |
| Active workspace tab | `studio.activeWorkspaceByBucket:v1` | Details, document relative path, or terminal agent-run ID by ticket/scratch bucket |

The selected-ticket and active-tab maps retain at most 100 recently touched
entries. Legacy `studio.studio.*`, `studio.coding.*`, and
`plane-tui:sidebar-visible` values are migrated to the current keys. Missing,
stale, malformed, or unavailable storage degrades safely: missing document or
terminal identities fall back to Details. The focused edit-view zone is never
persisted and always opens on Z1
(`src/state/persistence.ts`, `src/state/clientStore.ts`,
`src/app/shell/ticket-workspace/selected-ticket/internal/studioWorkspaceTarget.ts`).

## Behavioral test reference

The implemented contract is exercised through real key events and observable
focus/selection/tab behavior in:

- `src/test/overhaulEditViewNavigationAcceptance.test.tsx`
- `src/test/overhaulTerminalNavigationAcceptance.test.tsx`
- `src/test/studioEntry.test.tsx`

The terminology and intended boundaries match `CONTEXT.md` and
`docs/adr/0003-two-column-edit-view-modal-zone-navigation.md`.
