# Shell layout and footer

The Studio shell keeps the module workspace, resizable Stories and ticket panes, footer controls, and shared feedback surfaces together.

Surfaces: browser, desktop

## Sub-features

- `shell-workspace-layout`: Module tabs sit above the Stories and ticket workspace; the Module Manager takes over the work area while its underlying views stay mounted.
- `shell-pane-resize`: A named separator changes the Stories/workspace split and saves the two-pane ratio for later launches.
- `shell-footer-actions`: The footer opens the Module Manager, terminal panel, and Settings and shows module counts and attention.
- `shell-footer-hints`: Zone-specific hints describe navigation, engagement, and disengagement using current bindings.
- `shell-terminal-toggle`: The footer restores or minimizes the selected module's terminal panel and explains the unavailable state.
- `shell-modal-host`: One shared modal host presents the top descriptor with visible loading, failure, retry, and close paths.
- `shell-dialog-host`: Confirmation dialogs resolve a user choice through the shared dialog host; reassignment descriptors currently have no production caller.
- `shell-toasts`: The shared feedback host announces refused actions and supports dismissal and automatic expiry; success and informational severity styling has supplementary source/unit coverage.

## How to get to it

- After the startup gates, select a module to reach `module-workspace-region`; drag `pane-resize-handle` (separator **Resize adjacent panes**) between Stories and the ticket workspace.
- Use **Open Module Manager** / **Close Module Manager** in the footer, or `toggle-module-manager` (Cmd+Shift+M); the retained `toggle-sidebar` action (backslash) also opens the manager. **Open Settings** or `settings` (E, outside typing) opens Settings.
- Use `footer-terminal-toggle`: **Open terminal panel**, **Minimize terminal panel**, or the disabled **Select a module to open a terminal panel**. Its keyboard equivalent is `toggle-terminal-panel` (Ctrl+backtick). The control is implemented in [FooterTerminalToggle.tsx](../../studio/src/features/terminal-panel/FooterTerminalToggle.tsx); terminal contents belong to the terminals slice.
- Reach shared dialogs through a real action such as deleting a disposable issue; use **Cancel**, the action's confirmation label, or **Close dialog**. Reach toasts through the corresponding successful or refused action; use **Dismiss** on the message.

## Prerequisites

Select a project and a module to inspect the normal two-pane workspace. A selected module is required for the terminal toggle; its linked folder and shell readiness are separate terminal prerequisites. Close Module Manager, Plan, and Changes takeovers before measuring the Stories/workspace split. Use disposable records for confirmation and error paths, following the index's data rules.

## Expected behavior

- The shell has a fixed footer beneath its flexible work area. Stories and the ticket workspace each have a 15% minimum; their saved split is normalized to two columns, including migration of retired sidebar slots. Resizing writes the panel layout; Plan takeover does not save a replacement split. With no modules or all tabs hidden, the workspace shows the corresponding recovery view instead of an actionable pane split.
- Module Manager covers the work area below the module tabs. Covered ticket views remain mounted but are inert and hidden from accessibility; closing the takeover restores access. The footer manager button reflects open state with `aria-expanded` and `aria-pressed`, counts unarchived modules, and can show **Modules need attention**. Settings can show an update-available indicator; desktop update behavior is a separate area.
- Terminal pointer and keyboard entry points share the same toggle. With no selected module the footer control is disabled and names the reason. The panel open state follows module identity across switches and restart; minimizing preserves its shell. These behaviors are covered by the terminal acceptance cases below.
- Hints change with the edit-view zone: **Next Zone**, **Story**, **Tab**, **Body**, **Engage**, or **Type** as applicable. An engaged active body shows **Disengage** (Cmd+Escape); Plan and Changes suppress these edit-view hints.
- Empty modal/dialog stacks render nothing. Modal chunks show a `status` such as **Loading Settings…**; a failed chunk becomes an `alert` with **Retry** and **Close** instead of blanking Studio. Shared modal surfaces expose a named `dialog`, trap Tab/Shift+Tab, and close on Escape. Confirmation initially focuses **Cancel** and resolves false on cancel/close. Reassignment rendering is source-only: the descriptor can offer **Reassign to** or an empty-candidate **Continue**, but no production action currently invokes it. See [ModalSurface.tsx](../../studio/src/shared/ui/ModalSurface.tsx) for the shared focus boundary.
- `toast-host` contains `toast-success`, `toast-info`, or `toast-error`. Success/info use `status` with polite announcements and expire after four seconds; errors use `alert` with assertive announcements and expire after eight seconds. **Dismiss** removes the selected message. Settings temporarily hides toast rendering; native placement keeps visible messages outside presented terminal content.

## Verifying it

The browser feature suite is `studio/e2e/features/shell-layout-and-footer.spec.ts`; run `bun run --cwd studio test:e2e:feature shell-layout-and-footer`. Its coverage table below cites browser cases; verification status comes from retained runner evidence. Existing supplementary tests provide these distinct seams:

- Separator semantics: `studio/src/test/overhaulLayoutAcceptance.test.tsx` (`overhaul-18`); run `bun run --cwd studio test src/test/overhaulLayoutAcceptance.test.tsx`.
- Current manager takeover/footer: `studio/src/test/overhaulModuleManagerLayoutAcceptance.test.tsx` and `studio/src/test/overhaulModulePickerAcceptance.test.tsx` (`overhaul-237` keeps the footer entry outside scrolling tabs); run `bun run --cwd studio test src/test/overhaulModuleManagerLayoutAcceptance.test.tsx src/test/overhaulModulePickerAcceptance.test.tsx`.
- Terminal pointer toggle, bounded resize, and module persistence: `studio/src/test/overhaulTerminalPanelFurnitureAcceptance.test.tsx` (`overhaul-102`, `overhaul-119`, `overhaul-121`) and `studio/src/test/overhaulTerminalPanelModuleScopeAcceptance.test.tsx` (`overhaul-120`); run `bun run --cwd studio test src/test/overhaulTerminalPanelFurnitureAcceptance.test.tsx src/test/overhaulTerminalPanelModuleScopeAcceptance.test.tsx`.
- Modal singleton, loading/failure recovery, and dialog confirm/cancel: `studio/src/test/singleModalHost.test.tsx`, `studio/src/test/overhaulModalLoadFailureAcceptance.test.tsx` (`overhaul-220`–`overhaul-224` and `overhaul-825`; `overhaul-825` keeps the failed chunk import rejected, as browsers cache it, and requires Retry to request a fresh chunk URL), and `studio/src/test/overhaulDialogAcceptance.test.tsx` (`overhaul-20`); run `bun run --cwd studio test src/test/singleModalHost.test.tsx src/test/overhaulModalLoadFailureAcceptance.test.tsx src/test/overhaulDialogAcceptance.test.tsx`.
- Toast expiry and native-placement integration: `studio/src/test/toastStore.test.ts` and `studio/src/test/overhaulToastNativeOcclusionAcceptance.test.tsx` (`overhaul-236`); run `bun run --cwd studio test src/test/toastStore.test.ts src/test/overhaulToastNativeOcclusionAcceptance.test.tsx`. Native views are mocked in Vitest; this is not installed-desktop proof.
- Browser split persistence and shell visibility: `studio/e2e/web-app.spec.ts`, cases **resizes adjacent panes and persists the split** and **opens, hides, restores, and closes a Rust-backed module shell**; run `bun run --cwd studio test:e2e e2e/web-app.spec.ts --grep 'resizes adjacent panes and persists the split|opens, hides, restores, and closes a Rust-backed module shell'`. Observe separator `aria-valuenow` before/after reload and toggle labels/panel presence, rather than just a screenshot.

## End-to-end suite

Suite: studio/e2e/features/shell-layout-and-footer.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| shell-workspace-layout | @case-shell-manager-visibility | @case-shell-manager-visibility | n/a: composition has no independent network operation | @case-shell-empty-workspace | @case-shell-manager-visibility | @case-shell-manager-visibility |
| shell-pane-resize | @case-shell-split-persistence | n/a: drag commits continuously without a cancel operation | n/a: local preference writes fail silently without an error UI | @case-shell-empty-workspace | @case-shell-split-persistence | @case-shell-split-persistence |
| shell-footer-actions | @case-shell-footer-hints @case-shell-manager-visibility @case-shell-terminal-toggle | @case-shell-manager-visibility @case-shell-modal-recovery | @case-shell-modal-recovery | @case-shell-empty-workspace | @case-shell-manager-visibility @case-shell-terminal-toggle @case-shell-modal-recovery | @case-shell-manager-visibility @case-shell-terminal-toggle |
| shell-footer-hints | @case-shell-footer-hints | n/a: hints are read-only | n/a: hints are derived from local navigation state | n/a: selected navigation zones always have bindings | @case-shell-footer-hints | n/a: focus and engagement are transient |
| shell-terminal-toggle | @case-shell-terminal-toggle | @case-shell-terminal-toggle | n/a: toggle is local and synchronous; session startup errors belong to module-terminal-panel | @case-shell-empty-workspace | @case-shell-terminal-toggle | @case-shell-terminal-toggle |
| shell-modal-host | @case-shell-modal-entry | @case-shell-modal-entry @case-shell-modal-recovery | @case-shell-modal-recovery | @case-shell-modal-entry | @case-shell-modal-entry | n/a: modal stack is transient |
| shell-dialog-host | @case-shell-confirmation | @case-shell-confirmation | n/a: choices resolve synchronously; mutation errors belong to the invoking feature | @case-shell-confirmation | @case-shell-confirmation | @case-shell-confirmation |
| shell-toasts | @case-shell-toast-error | @case-shell-toast-error | @case-shell-toast-error | @case-shell-toast-error | @case-shell-toast-error | n/a: transient announcements do not survive reload |

The two legacy titles are retained in `studio/e2e/web-app.spec.ts`. Their
Module Manager selectors follow the intentional CODING-2643 replacement.
CODING-2708 recorded these cases as setup-blocked, with their own outcomes
unknown; this suite supplies current browser evidence rather than treating
those skipped baseline cases as passes.

## Relevant code

- `studio/src/app/shell` and `studio/src/app/modal`: mapped shell composition and shared modal areas; ticket-detail and domain-specific contents follow their own map slices.
- `studio/src/app/shell/StudioShell.tsx`, `studio/src/app/shell/StudioLayout.tsx`, and `studio/src/app/shell/ticket-workspace/TicketWorkspace.tsx`: shell composition, takeovers, and two-pane workspace.
- `studio/src/app/shell/layout/useStudioPanelLayout.ts`, `studio/src/app/shell/layout/layoutMath.ts`, `studio/src/shared/ui/PaneResizeHandle.tsx`, and `studio/src/state/persistence.ts`: resize, normalization, and saved layout.
- `studio/src/app/shell/StudioFooter.tsx`, `studio/src/app/shell/StudioFooterActions.tsx`, `studio/src/app/shell/FooterModuleManagerToggle.tsx`, and `studio/src/app/shell/StudioFooterHints.tsx`: footer actions and current hints.
- `studio/src/features/terminal-panel/FooterTerminalToggle.tsx`: the footer's pointer entry into the shared panel toggle; full terminal-panel behavior is mapped by the terminals slice.
- `studio/src/app/modal/ModalHost.tsx`, `studio/src/app/modal/ModalShell.tsx`, `studio/src/app/modal/ModalErrorBoundary.tsx`, and `studio/src/app/modal/modalStore.ts`: modal stack and recovery.
- `studio/src/app/shell/DialogHost.tsx`, `studio/src/app/shell/dialogStore.ts`, `studio/src/app/shell/ToastHost.tsx`, `studio/src/app/shell/toastStore.ts`, and `studio/src/app/shell/useToastViewportPlacement.ts`: confirmations and transient feedback.

## Gotchas

- Browsers cache a failed dynamic import by URL, so a fresh `React.lazy` wrapper alone cannot recover a network-aborted modal chunk (CODING-2749). `studio/src/app/modal/recoverableChunkImport.ts` reads the failed URL from the import error and, on **Retry**, imports it again with a unique `chunk-retry` query, without a page reload. Chromium and Firefox name the URL in the error; WebKit's `Importing a module script failed.` does not, so WebKit falls back to the plain re-import. A failure in a nested static dependency of the modal chunk stays cached under the dependency's URL. `@case-shell-modal-recovery` passes in full-suite run `2026-10-11T20-26-31-575Z-a3d6437d` (the earlier failure is in `2026-10-10T15-50-36-796Z-03ac9f09`).

- CODING-2711 updates the shared onboarded setup to the CODING-2643 Module Manager path; legacy specs retain their old steps until the final migration ticket.
- Historical Modules-pane cases in `studio/e2e/web-app.spec.ts` still request removed `modules-pane-toggle` and `pane-modules` selectors. Current shell source uses the Module Manager; those cases are not evidence for the current manager or layout.
- The reassignment descriptor has no production caller (only store and test references); its candidate and empty-candidate paths cannot be exercised through the browser UI. Footer hint browser coverage is in the feature suite.
- A hidden or covered workspace can remain mounted. Assert user reachability and focus, not mere DOM existence. JSDOM separator tests cannot prove actual pointer geometry, native stacking, or persisted installed-app behavior.
- Success/info severity announcements and native placement are supplementary source/unit coverage, not established by the browser error-delivery case.
- Toasts disappear by design and are hidden while Settings is open. Wait for the relevant status/alert; do not mistake expiry or suppression for a missing error.
