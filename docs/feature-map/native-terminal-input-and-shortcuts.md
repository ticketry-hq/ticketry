# Native terminal input and shortcuts

Desktop terminals translate AppKit keys into libghostty input while routing a small set of Studio shortcuts back to the WebView.

Surfaces: desktop, manual

## Sub-features

- native-input-studio-chords: escape an engaged native terminal through shared Studio actions.
- native-input-command-routing: give only the focused, live native surface its Command-key bindings.
- native-input-shift-enter: send ESC CR for exact Shift+Enter and CR for plain Enter only when the input method does not own or consume the key.
- native-input-ime-composition: retain AppKit marked text and commit UTF-8 without dispatching consumed keys to terminal bindings.
- native-input-window-zoom: route native zoom chords to window hotkeys without transferring focus.
- native-input-webview-composition: switch native/WebView input ownership without recreating the terminal.

## How to get to it

Open a ticket, conversation or module-panel terminal and engage its native host by clicking it. Renderer selection, session prerequisites and fallback belong to [Ticket terminals](ticket-terminals.md) and [Module terminal panel](module-terminal-panel.md). The keyboard must belong to the presented native viewer; DOM-only key events exercise a different route.

While it owns input, the native chord classifier recognizes the following defaults from `studio/src-tauri/native/libghostty_studio_chord.m`; action routing is in `studio/src/app/navigation/nativeTerminalChords.ts`:

| Native chord | Shared action/result |
| --- | --- |
| Ctrl+backtick | `toggle-terminal-panel`: open/minimize the module panel. |
| Cmd+E | `settings`: open the singleton Settings overlay. |
| Cmd+Shift+M | `toggle-module-manager`: open Module Manager; its effective configured binding is synchronized to the host. |
| Cmd+W | `close-tab`: close the active workspace terminal for the reporting run. |
| Cmd+Escape | Body disengagement: return to keyboard navigation in the current zone. |
| Cmd+1–9, Cmd+Shift+0 | `modules.select-position-1` through `modules.select-position-10`: select a visible module position. |
| Cmd+= or Cmd++, Cmd+minus, Cmd+0 | Zoom in, out or reset through window hotkeys; keypad equivalents are recognized. |

Type Shift+Enter in the engaged terminal for the bundled newline encoding. Settings and Module Manager also have ordinary UI entry points, described in their own entries. See [Keyboard navigation and shortcuts](keyboard-navigation-and-shortcuts.md) for WebView contexts and default bindings; they are not all native-host chords.

## Prerequisites

- macOS desktop with embedded native libghostty available, a presented terminal and keyboard ownership. The xterm/browser fallback does not prove this input route. Current shipping configuration targets macOS 11+ in `studio/src-tauri/tauri.conf.json`; the native implementation is macOS-specific.
- Native scripts require macOS AppKit and clang/Xcode command-line tools. Routing and isolated text-input tests need pinned `ghostty.h`; sibling composition also includes the vendored header. Run `bun run --cwd studio libghostty:prepare` when prepared resources are absent. The Shift+Enter byte test additionally links the pinned `libghostty.a` and loads its bundled resources.
- An installed-app walkthrough needs an interactive macOS window session, the native renderer and a terminal child that exposes input results. Testing provider prompt newline semantics additionally requires the intended provider/version; a raw PTY byte test does not establish that provider's UI response.

## Expected behavior

- AppKit input interpretation owns marked/consumed composition keys before terminal binding dispatch. Committed text reaches libghostty once; unconsumed ordinary keys keep Ghostty's key translation. Recognized Studio chords are consumed before its binding lookup and reported through `native-terminal-chord`; all except zoom hand AppKit first responder back to the WebView. The host reports identities rather than mutating application state (`studio/src-tauri/native/libghostty_view.m`, `studio/src-tauri/native/libghostty_text_input.m`, `studio/src-tauri/native/libghostty_command_routing.m`).
- Panel, Settings and visible-module routes reuse the existing frontend actions. Module Manager suppresses other native reports while active. Close-tab, body-disengage and Module Manager require the current handle/run owner and no open modal; stale owner reports are ignored. Unknown chord identities are ignored, subscriptions stop on unmount, and the Rust chord sink refuses reports after detachment begins (`studio/src/app/navigation/nativeTerminalChords.ts`, `studio/src-tauri/crates/app/ticketry-desktop/src/native_terminal/chords.rs`).
- Cmd+Escape leaves the panel, selected module, ticket, document and terminal session intact while ending body engagement. Cmd+W enters the existing terminal-close flow; close/reclaim outcomes are described in [Ticket workspace tabs](ticket-workspace-tabs.md). Cancelling a Settings/Manager overlay returns through those surfaces' focus rules; it is not a terminal restart.
- Only the focused, input-enabled view with a live surface owner claims Command bindings. Unfocused/invalidated retained views return refusal; unbound application commands remain available to AppKit. A detached view cannot query a stale Ghostty surface (`studio/src-tauri/native/libghostty_command_routing.m`).
- The native application menu removes stock **Close Window**, allowing Cmd+W to reach Studio rather than quit the single-window app (`studio/src-tauri/crates/app/ticketry-desktop/src/desktop/window_menu.rs`). Stock menu and pasteboard facilities are listed as exclusions in [the index](README.md).
- The bundled `studio/src-tauri/native/ticketry-ghostty.conf` binds exact Shift+Enter to bytes `1b 0d` (ESC CR). Plain Enter sends `0d`. The real-library test preserves Ctrl/Alt variants and Ghostty's Cmd+Enter fullscreen / Cmd+Shift+Enter split-zoom bindings; it does not prove Ticketry implements those Ghostty actions (`studio/src-tauri/native/tests/libghostty_shift_enter_tests.m`).
- Active marked text and input-method consumption prevent Shift+Enter from entering Ghostty's binding lookup, including when the key commits or cancels composition. Merely setting Ghostty's `composing` flag cannot protect this explicit binding because the pinned core checks bindings first. The production host implements `NSTextInputClient` through `studio/src-tauri/native/libghostty_text_input.m`; UTF-8 commit, preedit and candidate geometry reuse that seam.
- Zoom reports use the same window hotkey event shape without moving native focus or selecting a module. Native font size follows WebView zoom through `studio/src-tauri/native/libghostty_zoom.m`; zoom persistence across app restart is not established here.
- Native and WebView views remain siblings: native ownership raises/enables the terminal; DOM overlay ownership lowers/disables it while preserving the view. Hidden viewers reject input. Invalid sibling ordering reports failure, allowing the renderer recovery path; it is not silently treated as success (`studio/src-tauri/native/libghostty_webview_composition.m`, `studio/src-tauri/native/libghostty_view_bridge.m`).

## Verifying it

Observe the real `native-terminal-host` with `data-terminal-renderer="libghostty"` and `data-native-terminal-presented`, then the resulting Settings/Manager overlay, module selection, panel visibility or body navigation. Read back the same run/session identity after a focus or overlay change. These selectors establish host presentation, not emitted PTY bytes or physical keyboard routing. No live walkthrough was performed for this map entry.

| Existing coverage | Narrowest command and evidence limit |
| --- | --- |
| `studio/scripts/test-native-ghostty-command-routing.sh` compiles `studio/src-tauri/native/tests/libghostty_command_routing_tests.m`: focused/live first refusal, unbound refusal, multiple surfaces, invalidated owner and Studio chord bypass. | `bun run --cwd studio test:native-ghostty-command-routing`; AppKit executable with stubbed Ghostty binding calls, not an installed app. |
| `studio/scripts/test-native-ghostty-studio-chords.sh` compiles `studio/src-tauri/native/tests/libghostty_studio_chord_tests.m`: exact modifiers, module positions, keypad zoom and Module Manager rebinding. | `bun run --cwd studio test:native-ghostty-studio-chords`; native classification unit proof, not physical-keyboard or layout proof. |
| `studio/scripts/test-native-ghostty-webview-composition.sh` compiles `studio/src-tauri/native/tests/libghostty_webview_composition_tests.m`: sibling ordering, first-responder handoff, enabled/hidden input, pointer/scroll routing, zoom and queued-view lifetime. | `bun run --cwd studio test:native-ghostty-webview-composition`; real AppKit views with stubbed Ghostty calls and a substitute WebView, not real WKWebView pixels. |
| `studio/scripts/test-native-ghostty-shift-enter.sh` and `studio/src-tauri/native/tests/libghostty_shift_enter_tests.m`: production key translation, bundled config and a real pinned-libghostty PTY child recording exact bytes. | `sh studio/scripts/test-native-ghostty-shift-enter.sh`; requires pinned static library/resources and AppKit window backing, but displays no window. It proves ESC CR / CR bytes, not installed bundle freshness, tmux/provider interpretation or real key delivery. No package alias exists. |
| `studio/scripts/test-native-ghostty-ime-input.sh` and `studio/src-tauri/native/tests/libghostty_ime_input_tests.m`: the production host linked to pinned libghostty, active marked/consumed input, real PTY bytes, UTF-8 commit and ordinary Enter/modifier regressions. | `sh studio/scripts/test-native-ghostty-ime-input.sh`; deterministic AppKit input-context substitution drives the production view. It proves the host boundary blocks ESC CR during composition, not a physical keyboard or actual OS IME candidate session. |
| `studio/src/test/overhaulNativeImeShiftEnterAcceptance.test.tsx`: `overhaul-826`. | `bun run --cwd studio test -- src/test/overhaulNativeImeShiftEnterAcceptance.test.tsx`; invokes the production-host PTY runner and skips outside macOS. |
| `studio/scripts/test-native-ghostty-text-input.sh` and `studio/src-tauri/native/tests/libghostty_text_input_tests.m`: preedit, UTF-8 commit/cancel and candidate geometry. | `sh studio/scripts/test-native-ghostty-text-input.sh`; isolated helper tests use a substitute view and stub Ghostty calls, so the production-host runner above supplies the missing dispatch evidence. |
| `studio/src/test/desktopShellContract.test.ts`: local main-window capability, native command registration, zoom hotkeys and packaged resources. | `bun run --cwd studio test -- src/test/desktopShellContract.test.ts`; source/config contract assertions only. |
| `studio/src/test/overhaulNativeGhosttyCommandRoutingAcceptance.test.tsx`: `overhaul-178`. | `bun run --cwd studio test -- src/test/overhaulNativeGhosttyCommandRoutingAcceptance.test.tsx`; source assertion only. |
| `studio/src/test/overhaulNativeViewLifetimeAcceptance.test.tsx`: `overhaul-270`. | `bun run --cwd studio test -- src/test/overhaulNativeViewLifetimeAcceptance.test.tsx`; invokes the native composition script and skips outside macOS. |
| `studio/src/test/overhaulTerminalPanelNativeChordAcceptance.test.tsx`: panel reversal, visible-module routing, unsubscribe and browser no-subscription. | `bun run --cwd studio test -- src/test/overhaulTerminalPanelNativeChordAcceptance.test.tsx`; mocked Tauri host events. |
| `studio/src/test/overhaulNativeBodyDisengageAcceptance.test.tsx`: `overhaul-180`. | `bun run --cwd studio test -- src/test/overhaulNativeBodyDisengageAcceptance.test.tsx`; mocked native ownership/events prove frontend effects and stale-report guards. |
| `studio/src/test/overhaulNativeTerminalCloseAcceptance.test.tsx`: `overhaul-402`. | `bun run --cwd studio test -- src/test/overhaulNativeTerminalCloseAcceptance.test.tsx`; mocked owner/event route into close behavior. |
| `studio/src/test/overhaulUnifiedZoomAcceptance.test.tsx`: `overhaul-299`. | `bun run --cwd studio test -- src/test/overhaulUnifiedZoomAcceptance.test.tsx`; mocked native event equivalence, not actual AppKit focus or window zoom. |
| `studio/src/test/overhaulModuleJumpBadgesAcceptance.test.tsx`: `overhaul-179`. | `bun run --cwd studio test -- src/test/overhaulModuleJumpBadgesAcceptance.test.tsx`; substituted host events and visible projection. |
| `studio/src/test/overhaulModuleManagerNativeAcceptance.test.tsx`: `overhaul-613`. | `bun run --cwd studio test -- src/test/overhaulModuleManagerNativeAcceptance.test.tsx`; substituted renderer/host suppression, restoration and chord integration. |
| `studio/src/test/overhaulSettingsNativeOcclusionAcceptance.test.tsx`: `overhaul-117` plus native Settings chord. | `bun run --cwd studio test -- src/test/overhaulSettingsNativeOcclusionAcceptance.test.tsx`; substituted native boundary proves singleton action integration. |
| `studio/src/test/overhaulNativeWebViewSiblingAcceptance.test.tsx`: `overhaul-233`/`234`, selection and ordering failure. | `bun run --cwd studio test -- src/test/overhaulNativeWebViewSiblingAcceptance.test.tsx`; mocked native calls and DOM composition. |
| Rust chord identities, unknown codes and detachment/replacement refusal in `studio/src-tauri/crates/app/ticketry-desktop/src/native_terminal/chords.rs`. | `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-desktop native_terminal::chords::tests`; unit sink evidence, no window or PTY input. |

The numbered gate is `bun run --cwd studio test:overhaul`. The [desktop agent harness](../../studio/e2e-desktop/README.md), `bun run --cwd studio test:e2e:desktop`, covers real disposable-provider launch, native terminal presentation and lifecycle persistence; it is broader than an input check and does not exhaust these shortcut, byte or OS keyboard paths. Manual installed-desktop checks remain necessary for physical keys, non-US layouts, actual window focus/occlusion, display scaling and provider multiline prompts: jsdom/stubs cannot drive the OS input stack, and the byte harness bypasses the real keyboard and provider.

## End-to-end suite

Suite: excluded (desktop-only): `studio/src/runtime/browserRuntime.ts` declares `nativeTerminal: false`, so browser terminals render with xterm over `browserTerminalClient` and never create the AppKit libghostty surface whose chord routing, Command-key ownership, ESC CR Shift+Enter bytes, zoom hotkeys and WebView composition handoff this entry maps. Browser keyboard behavior is proven by [Keyboard navigation and shortcuts](keyboard-navigation-and-shortcuts.md) and xterm terminals by [Module terminal panel](module-terminal-panel.md) and [Ticket terminals](ticket-terminals.md).

## Relevant code

- `studio/src/app/navigation/nativeTerminalChords.ts`, `studio/src/app/navigation/keymapBindings.ts` and `studio/src/runtime/nativeTerminalKeyboard.ts`: shared actions, effective Manager binding and owner guards.
- `studio/src-tauri/native/libghostty_studio_chord.m`, `studio/src-tauri/native/libghostty_command_routing.m` and `studio/src-tauri/native/libghostty_key_event.m`: AppKit recognition, first refusal and event translation.
- `studio/src-tauri/native/libghostty_host.m`, `studio/src-tauri/native/libghostty_view.m`, `studio/src-tauri/native/libghostty_text_input.m`, `studio/src-tauri/native/libghostty_view_bridge.m`, `studio/src-tauri/native/libghostty_surface_owner.m` and `studio/src-tauri/native/libghostty_webview_composition.m`: production composition assembly, first responder, visibility, surface lifetime and sibling ownership.
- `studio/src-tauri/native/libghostty_zoom.m` and `studio/src-tauri/native/ticketry-ghostty.conf`: native font synchronization and Shift+Enter binding.
- `studio/src-tauri/crates/app/ticketry-desktop/src/native_terminal/chords.rs` and `studio/src-tauri/crates/app/ticketry-desktop/src/native_terminal/macos/platform_bridge.rs`: chord identities, lifetime fence and host event emission.
- `studio/src/features/agents/terminal/internal/useNativeWebViewSiblingInteraction.ts` and `studio/src/features/agents/terminal/internal/useNativeViewerHostEffects.ts`: frontend selection/focus ownership.
- [Desktop Runtime context](../../studio/src-tauri/crates/app/ticketry-desktop/src/desktop/CONTEXT.md): runtime ownership vocabulary; [Ticket terminals](ticket-terminals.md) owns renderer/session coverage.

## Gotchas

- Most native chords use physical Mac key codes and exact modifier combinations; Caps Lock is excluded from matching. Only the Module Manager effective binding is synchronized from the keymap here. Do not infer that rebinding every WebView shortcut changes its native counterpart or that arbitrary layouts have installed coverage.
- Cmd+0 is zoom reset; the tenth module is Cmd+Shift+0. Native Cmd+E reaches Settings although the ordinary global WebView default is E. Ordinary native terminal typing does not receive every Studio capture/global binding.
- The WebView composition script means native sibling ordering/input ownership, not IME text composition. The production-host IME runner exercises the actual host with deterministic input-method behavior; it does not establish actual OS IME/dead-key composition or installed-bundle freshness. Record an isolated desktop walkthrough separately before claiming physical input-method coverage.
- Source configuration and byte tests do not establish that an existing installed bundle contains that configuration. Check the target artifact before claiming installed Shift+Enter behavior. Ghostty fullscreen/split-zoom binding dispatch is tested, but visible host implementation of those actions is unverified here.
- Browser key events and mocked native host events cannot establish real macOS keyboard ownership, pixels or tmux/provider handling. Existing scripts require AppKit even where they use no displayed window; Linux skips are not native passes.
