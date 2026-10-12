# Keyboard navigation and shortcuts

Studio routes keyboard input through context-aware bindings and explicit workspace zones, with separate shortcut discovery and persisted customization.

Surfaces: browser, desktop
Editions: pocock, core

## Sub-features

- `keyboard-keymap-contexts`: The registry resolves modal, capture, focused-pane, global, and Changes contexts with effective bindings and platform restrictions.
- `keyboard-edit-view-zones`: Stories, the tab strip, the active body, and the visible terminal panel have explicit navigation and engagement states.
- `keyboard-workspace-tab-cycling`: Command chords cycle ticket workspace tabs; focused workspace tabs also support local tablist navigation.
- `keyboard-close-tab`: Close Tab targets the active document or terminal while preserving non-closable Details and protected takeovers.
- `keyboard-configurable-bindings`: Settings records, saves, reloads, resets, and restores configurable action bindings.
- `keyboard-shortcuts-modal`: Question mark opens Settings directly at its searchable Keyboard shortcuts section.

## How to get to it

- Select a module and Story, then use `edit-view.next-zone` (Shift+Tab), `edit-view.up/down/left/right` (arrows), and `edit-view.commit` (Enter). On an engaged body use `edit-view.body-disengage` (Cmd+Escape) to return to navigation.
- Use `workspace-tab-next` (Cmd+Right) / `workspace-tab-previous` (Cmd+Left) for ticket tabs in **Workspace tabs** (`workspace-tabs`). In the top **Project module tabs** tablist, use Left/Right or Home/End. The ticket tab-strip zone has its own highlight-and-commit semantics.
- Use `close-tab`: fixed capture chord Cmd+W or global default Q. Use `cycle-terminal-forward` (Cmd+backslash) / `cycle-terminal-backward` (Cmd+Shift+backslash) for live terminal stops, or `toggle-terminal-panel` (Ctrl+backtick) for the module panel.
- `show-shortcuts` (?) opens **Studio settings** directly at **Keyboard shortcuts**, the same section reached by **Open Settings** → **Keyboard shortcuts**. It exposes editable **Keyboard settings**, **Search bindings**, **Restore defaults**, and action-specific binding/reset buttons. The standalone `KeyboardShortcutsModal` component remains in source but is not selected by the production help action. Implementations are [KeyboardShortcutsModal.tsx](../../studio/src/features/studio/modals/KeyboardShortcutsModal.tsx), [KeyboardSettingsPanel.tsx](../../studio/src/features/studio/modals/KeyboardSettingsPanel.tsx), and [KeybindingSettings.tsx](../../studio/src/features/studio/modals/KeybindingSettings.tsx).
- Useful global defaults outside editable input are `search` (/), `settings` (E), `toggle-module-manager` (Cmd+Shift+M), and legacy `toggle-sidebar` (backslash, now Module Manager). Modal defaults are `modal.close` (Escape), `modal.next/previous` (Down/Up), `modal.confirm` (Enter), and `modal.submit` (Ctrl+Enter, default alias Cmd+Enter); individual modals allow only the actions they handle.

## Prerequisites

A selected module and a navigable ticket workspace are needed for zone/tab routes. Open documents or terminal sessions to exercise their cycling and close paths. The panel contributes a zone only while showing. Close Module Manager, Plan, Changes, and modals to test ordinary edit-view routing; each takeover owns its local keyboard behavior. Existing saved overrides can change configurable chords, so inspect effective bindings before asserting defaults. Numeric `modules.select-position-1` through `modules.select-position-10` are desktop-only (Cmd+1–9 and Cmd+Shift+0).

## Expected behavior

- The declared normal context precedence is modal → capture → focused-pane → global; Changes controls resolve their dedicated context locally. The global handler defers to native button/tab activation, modal ownership, editable targets, and prevented events. Module Manager and Plan/Changes takeovers own their navigation; ordinary Stories arrows must not leak into them.
- Shift+Tab cycles Stories → tab strip → active body, adding terminal panel only while it is visible. Stories Up/Down select rows; Right expands a collapsed expandable Story, otherwise dives into its remembered body; Enter also dives. Tab-strip Left/Right highlight tabs; Enter or Down commits and dives. Left at the first highlighted tab returns to Stories. In an unengaged active body, Up returns to tabs and Left to Stories; Enter engages the body. Entering the terminal-panel zone already engages its shell; Up returns to the active body and Left to Stories.
- Cmd+Escape disengages terminal/body input without closing its surface. While engaged, ordinary typing belongs to the body; terminal-panel toggle and close-tab capture routes remain reachable. Browser terminal input and desktop native-host chords use different transports, so browser success does not establish native chord routing.
- Cmd+Left/Right activates previous/next ticket workspace tabs and clamps at the ends. Focused top-level **Project module tabs** use a roving focus implementation whose Left/Right wraps and activates, while Home/End selects the first/last enabled tab. This differs from ticket edit-zone highlight-before-commit behavior. Live terminal cycling wraps over available live stops and follows persisted terminal ordering; a failed order load leaves selection unchanged.
- Close Tab closes the active document or terminal; Details remains open. Document dismissal is held in the current workspace only and does not persist across reload; closing the active document separately remembers Details as the restoration target. Missing ticket/session targets are safe no-ops. Plan refuses the close route, and terminal close also refuses Changes; Cmd+W reaches the selected terminal even while it owns typing. Closing a terminal can stop its run: use disposable sessions.
- Binding recording ignores modifier-only keys. Escape cancels recording. A conflicting chord reports **That chord is already assigned to …** without saving. A successful save adopts the authoritative settings response; reload restores persisted overrides. Reset removes one override; Restore defaults removes all. Save failure reports an error and retains existing effective bindings; load failure falls back to defaults. Modal close is locked in the settings UI; fixed navigation actions are not configurable.
- Registered actions follow the compiled edition (CODING-2864). Pocock never registers `toggle-voice-transcription`: it is absent from the registry, effective and configurable bindings and shortcut settings, and dispatching it is unhandled rather than inert. A stored override for it stays in storage and is ignored on load without a warning or error. Core registers it as before; it has no default chord, so even core lists it in no settings row, and only the Launchkey Record button dispatches it. Saving any binding still rewrites the override list from registered actions in both editions.
- Shortcut help opens the editable settings section. Filtering searches action/context labels and announces **No bindings match** when empty. The standalone read-only panel is not a reachable help entry point.

## Verifying it

Browser suite: `studio/e2e/features/keyboard-navigation-and-shortcuts.spec.ts`; run `bun run --cwd studio test:e2e:feature keyboard-navigation-and-shortcuts`. Legacy cases remain in place. Supplementary coverage and narrow commands are:

- Current edit-view navigation, Cmd+Arrow cycling, body disengagement, and legacy-sidebar-state tolerance: `studio/src/test/overhaulEditViewNavigationAcceptance.test.tsx` (`overhaul-136`, `overhaul-253` and named navigation cases); run `bun run --cwd studio test src/test/overhaulEditViewNavigationAcceptance.test.tsx`. Observe `[data-navigation-zone="stories"]`, `[data-navigation-zone="active-tab-body"]`, tab selection, and focus rather than invoking routing helpers as manual proof.
- Panel zone participation/disengagement: `studio/src/test/overhaulTerminalPanelZoneAcceptance.test.tsx` (`overhaul-103`, `overhaul-104`); run `bun run --cwd studio test src/test/overhaulTerminalPanelZoneAcceptance.test.tsx`.
- Live terminal cycling, saved order, and close/resume: `studio/src/test/overhaulTerminalNavigationAcceptance.test.tsx` (`overhaul-08`, `overhaul-173`, `overhaul-16`); run `bun run --cwd studio test src/test/overhaulTerminalNavigationAcceptance.test.tsx`. Chord resolution alone is covered by `studio/src/app/navigation/closeTabChord.test.ts`; run `bun run --cwd studio test src/app/navigation/closeTabChord.test.ts`.
- Settings persistence/default/error seam: `studio/src/test/overhaulKeybindingSettingsRuntimeAcceptance.test.tsx` (`overhaul-75`–`overhaul-77`); run `bun run --cwd studio test src/test/overhaulKeybindingSettingsRuntimeAcceptance.test.tsx`. Browser UI persistence/execution/reset exists in `studio/e2e/web-app.spec.ts`, case **persists, executes, and resets a custom Search shortcut**; run `bun run --cwd studio test:e2e e2e/web-app.spec.ts --grep 'persists, executes, and resets a custom Search shortcut'`. Its stable accessible binding name is **Search, current shortcut Slash, change binding**, followed by **Reset Search binding**; reload and execute the changed chord before claiming persistence.
- Edition-registered actions: `studio/src/test/overhaulPocockLaunchkeyVoiceAcceptance.test.tsx` mounts the Pocock shell and checks that `toggle-voice-transcription` is unregistered, absent from bindings and settings, and that a stored override for it is ignored without error and kept in storage; run `bun run --cwd studio test:pocock src/test/overhaulPocockLaunchkeyVoiceAcceptance.test.tsx`. `studio/src/test/overhaulCoreLaunchkeyVoiceAcceptance.test.tsx` checks core registration and dispatch; run `bun run --cwd studio test src/test/overhaulCoreLaunchkeyVoiceAcceptance.test.tsx`.
- Native chord routing requires native coverage: `studio/src/test/overhaulTerminalPanelNativeChordAcceptance.test.tsx` exercises mocked host events; run `bun run --cwd studio test src/test/overhaulTerminalPanelNativeChordAcceptance.test.tsx`. Actual native routing uses `studio/scripts/test-native-ghostty-studio-chords.sh`; run `bun run --cwd studio test:native-ghostty-studio-chords` on supported desktop hardware/tooling. Neither replaces a real installed-desktop interaction claim.

## End-to-end suite

Suite: studio/e2e/features/keyboard-navigation-and-shortcuts.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| `keyboard-keymap-contexts` | @case-keyboard-search-return @case-keyboard-context-terminal-zone | @case-keyboard-search-return @case-keyboard-context-terminal-zone | n/a: Input routing has no asynchronous operation | n/a: Registry always supplies default actions | @case-keyboard-search-return | n/a: Focus ownership is transient |
| `keyboard-edit-view-zones` | @case-keyboard-three-zones @case-keyboard-context-terminal-zone | @case-keyboard-three-zones @case-keyboard-context-terminal-zone | n/a: Zone movement is synchronous | n/a: Stories zone always exists | @case-keyboard-three-zones | n/a: Zone focus is transient |
| `keyboard-workspace-tab-cycling` | @case-keyboard-tab-boundaries | n/a: Cycling commits immediately | n/a: Tab selection is synchronous | @case-keyboard-tab-boundaries | @case-keyboard-tab-boundaries | n/a: Chord cycling has no independent saved setting |
| `keyboard-close-tab` | @case-keyboard-tab-boundaries | n/a: Close route has no confirmation | n/a: Details refusal is synchronous | @case-keyboard-tab-boundaries | @case-keyboard-tab-boundaries | n/a: Closed document visibility is transient; terminal lifecycle persistence belongs to Ticket terminals |
| `keyboard-configurable-bindings` | @case-keyboard-search-persistence | @case-keyboard-binding-errors | @case-keyboard-binding-errors @case-keyboard-load-recovery | @case-keyboard-binding-discovery | @case-keyboard-binding-discovery @case-keyboard-search-persistence | @case-keyboard-search-persistence @case-keyboard-binding-errors |
| `keyboard-shortcuts-modal` | @case-keyboard-help-chord @case-keyboard-help-filter | @case-keyboard-help-chord @case-keyboard-help-filter | @case-keyboard-binding-errors @case-keyboard-load-recovery | @case-keyboard-help-filter | @case-keyboard-help-chord | n/a: Dialog opening and its filter are transient; persisted effective bindings are covered under configurable bindings |

## Relevant code

- `studio/src/app/navigation`: mapped registry, keyboard precedence, and shell navigation area.
- `studio/src/app/navigation/keymapBindings.ts`, `studio/src/app/navigation/keymapRegistry.ts`, and `studio/src/app/navigation/keymapSettings.ts`: defaults, effective overrides, platform availability, and settings persistence.
- `studio/src/features/studio/modals/KeyboardShortcutsModal.tsx`, `studio/src/features/studio/modals/KeyboardSettingsPanel.tsx`, and `studio/src/features/studio/modals/KeybindingSettings.tsx`: discovery, accessible binding controls, recording, conflict handling, and reset; the broader Studio feature domain remains assigned to the settings slice.
- `studio/src/app/navigation/useGlobalKeymap.ts`, `studio/src/app/navigation/sharedNavigation.ts`, `studio/src/app/navigation/workspaceNavigation.ts`, and `studio/src/app/navigation/nativeTerminalChords.ts`: context routing, takeovers, close-tab, live terminal cycle, and host chords.
- `studio/src/app/navigation/three-zone/threeZoneNavigation.ts` and `studio/src/shared/navigation/bodyEngagement.ts`: zone transitions and fixed disengagement chord.
- `studio/src/features/workspace-state/navigation.ts`: visible zone order, engagement on entry, and retired-sidebar compatibility behavior.
- `studio/src/app/shell/ticket-workspace/useWorkspaceTabNavigation.ts`, `studio/src/app/shell/ticket-workspace/ModuleTabStrip.tsx`, `studio/src/app/shell/ticket-workspace/WorkspaceTabs.tsx`, and `studio/src/app/shell/ticket-workspace/selected-ticket/appNavigation.ts`: module tablist focus and ticket workspace navigation boundary.
- `studio/src/features/task-workspace/internal/WorkspaceTabStrip.tsx` and `studio/src/features/task-workspace/internal/useTaskWorkspaceTabNavigation.ts`: ticket tab selectors, highlight, commit, and clamped Command cycling; complete workspace-tab lifecycle remains assigned to the work-items slice.
- `studio/src/app/modal/ModalShell.tsx` and `studio/src/shared/ui/ModalSurface.tsx`: modal action allowlists and focus/close behavior.
- [Existing keyboard-navigation reference](../../studio/KEYBOARD_NAVIGATION_CURRENT.md): useful historical context, with the stale sections identified below.

## Gotchas

- CODING-2751 records an observed startup/close race: closing a module shell before its prompt is ready returned `terminal_cleanup_storage_failed`. The terminal-zone case waits for observable prompt readiness and keeps its close-to-empty assertion; that passing path does not prove immediate close during startup.

- Canonical setup now uses the CODING-2643 Module Manager; legacy browser specs remain unchanged during migration.
- The linked keyboard reference still documents **Full sidebar view**, Projects/Modules pane focus, persisted sidebar visibility, and removed `full-sidebar-view` paths. Current `StudioLayout.tsx` has two panes plus Module Manager; `useGlobalKeymap.ts` has no full-sidebar branch. The reference also calls Cmd+Arrow inactive in edit view; current source and acceptance tests route those chords. Use this entry and current source for those facts.
- The migrated three-zone case replaces retired Modules-pane selectors under CODING-2643 while retaining its focus assertions. `openKeyboardShortcuts` routes to Studio settings; the previous map confused the retained standalone component with that production route.
- Feature-run evidence establishes browser outcomes; Vitest pointers remain supplementary. Standalone read-only shortcut discovery has no production entry point and is not claimed by this suite.
- Bare action keys must be tested outside editable or engaged body input. `?` may require Shift on the keyboard; the registry matches the reported `event.key`. Default aliases can disappear when a configurable chord is overridden; fixed aliases remain. Desktop numeric module chords are excluded from browser effective bindings.
