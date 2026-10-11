# Module folders and trust

Link a module to its local working folder, obtain explicit provider trust, and recover safely when folder setup blocks navigation or a shell.

Surfaces: browser, desktop

## Sub-features

- module-folder-link: save or replace the module's authoritative local folder link.
- module-folder-validation: reject incomplete paths and unusable host directories.
- module-folder-selection: type a path, reuse recent folders, or use the native picker.
- module-folder-native-picker: choose or cancel a directory through the native folder picker.
- module-folder-provider-trust: inspect activated providers and confirm the canonical trust target before writing.
- module-folder-required: explain missing or unusable folders and offer setup instead of starting a shell elsewhere.
- module-folder-retry-safety: retain the old link and created module identity through cancellation, failures and stale navigation.

## How to get to it

- With a module selected, keymap action `set-folder` (default `F`) opens the `Module Folder` dialog. It contains a textbox, `Recent folders` list when links exist, `Save` and `Cancel`; desktop exposes `Pick Folder` when the runtime supports a native picker. See `studio/src/app/navigation/sharedNavigation.ts` and `studio/src/features/agents/terminal/ModuleFolderSelection.tsx`.
- Selecting an unlinked module can open the same dialog before changing selection. The module picker's `Create new module` option opens the `Add Module` dialog; Module Manager's inline `Create module` form collects the `Module folder` textbox before creation; its picker is `Pick Folder`. See [Module Manager](module-manager.md).
- A refused module shell shows `terminal-panel-folder-required`, textbox `Module folder for the terminal panel`, and `Use this folder` (`terminal-panel-link-folder`). Save an absolute folder here to retry opening the shell.
- In the folder modal, `modal.next` / `ArrowDown` and `modal.previous` / `ArrowUp` highlight recent folders; `modal.confirm` / `Enter` commits a highlighted folder first and saves on a subsequent Enter; `modal.close` / `Escape` cancels. The trust confirmation is named `Trust module folder?`, with `Trust folder` and `Cancel`. Defaults are in `studio/src/app/navigation/keymapBindings.ts`; configured bindings may differ.

## Prerequisites

- A selected module is required for `set-folder`; inline creation requires a selected project, nonblank module name and absolute folder path.
- For native validation/trust, use a desktop runtime and an existing readable directory. Use disposable provider configuration directories for tests, because confirmation updates the providers' durable trust settings.
- Trust is requested for activated Codex, Gemini and Claude providers. With none activated, folder linking needs no trust prompt. A failed provider-catalog read conservatively inspects all three (`studio/src/features/module-links/moduleFolderTrust.ts`).

## Expected behavior

- **Link and selection:** empty/whitespace and relative paths disable Save or show `Enter the full folder path, starting from the filesystem root.` Successful Save trims the path, writes a module-identity-bound link, closes the dialog, and resumes guarded module selection when requested. Links live in the generated GraphQL graph and Apollo cache; a refused write rolls the optimistic link back. Recent folders deduplicate already-linked absolute paths, most recently written first (`studio/src/features/module-links/moduleLinkStore.ts`, `studio/src/features/module-links/moduleLinkTransport.ts`).
- **Validation:** inline creation validates before trust and before creating a module. Desktop checks the actual host directory through `desktop_validate_module_folder`; browser's creation preflight checks only a leading `/`. The Rust link write still validates absolute path, existence, directory type and accessibility. See `studio/src/features/module-links/moduleFolderValidation.ts`, `studio/src/features/module-creation/useModuleCreation.ts` and `studio/src-tauri/crates/worktracking/ticketry-work-management/src/module_links/folder_preflight.rs`.
- **Trust:** browser has no provider trust adapter and links without provider calls. Desktop inspects the providers first; already-trusted folders need no confirmation. Otherwise the prompt names the canonical directory and providers still requiring approval. Cancel retains the previous link and does not create an inline module. Approval re-inspects scope before preparing trust and writing the link. Changed canonical targets/provider approval sets require renewed consent; denial, unsupported durable trust and inspection/preparation errors stay visible as alerts, with no link write (`studio/src/features/module-links/moduleFolderTrust.ts`).
- **Folder-required states:** an unset, relative, missing or non-directory folder produces a specific refusal message; other reasons fall back to `This module has no usable folder.` No shell starts in a fallback directory. `Use this folder` stays disabled until the path is complete, calls the shared trust/link flow, and only then resumes the shell (`studio/src/features/terminal-panel/ModuleFolderRequired.tsx`).
- **Retry:** partial provider trust success remains durable; the next Save inspects again and asks only for providers still needing trust. A replacement preserves the old link until trust finishes. If inline creation succeeds but folder saving fails, `Save folder` retries the same created identity instead of making a duplicate. Initial active-sprint discovery fills an unresolved scope without cancelling folder setup; explicit intent changes and subsequent active-sprint changes retain cancellation guards. Project/sprint/manager cancellation generations prevent stale creation from navigating; a tab explicitly closed while its folder save is pending is not reopened by the late completion. See `studio/src/features/module-creation/useModuleCreation.ts`, `studio/src/test/overhaulExplicitModuleNavigationAcceptance.test.tsx` and `studio/src/test/overhaulModuleManagerCreationAcceptance.test.tsx`.

## Verifying it

- **Link, validation and selection:** run `bun run --cwd studio test -- src/test/overhaulModuleFolderAcceptance.test.tsx src/features/module-links/moduleLinkStore.test.ts`. The unnumbered folder acceptance checks blank refusal, trimming and resumed selection; store tests cover authoritative reads, optimistic state/rollback, relative-path refusal and recent ordering. Observe the `Module Folder` dialog and disabled/enabled `Save`, then read `moduleLinks.nodes` (`moduleId`, `path`) through `LoadModuleLinks` in `studio/src/features/module-links/operations/moduleLinks.graphql`. Cache success alone is not reload proof: reload and read the authoritative link for a persistence check.
- **Trust and retries:** run `bun run --cwd studio test -- src/test/overhaulDirectoryTrustAcceptance.test.tsx`. Cases `[overhaul-300]`–`[overhaul-306]` cover canonical/provider copy, cancel, already-trusted success, denied/unsupported/errors, inspect/prepare/save order, partial retry, browser bypass and renewed consent; `[overhaul-358]`–`[overhaul-359]` cover activated-provider filtering and zero-provider setup. Assert the named trust dialog and alerts, old/new link, and no write on refusal. These tests mock provider adapters; they do not prove native configuration writes.
- **Folder-required and navigation recovery:** run `bun run --cwd studio test -- src/test/overhaulModuleSelectionAcceptance.test.tsx src/test/overhaulExplicitModuleNavigationAcceptance.test.tsx src/test/overhaulTerminalPanelAcceptance.test.tsx`. `[overhaul-291]`–`[overhaul-294]` cover trust cancel/retry, successful selection, pending replacement and terminal retry; `[overhaul-606]` reports folder action required and `[overhaul-609]` rejects late resumption after explicit tab close; `[overhaul-146]` checks `terminal-panel-folder-required` and `data-refusal-reason` rather than launching elsewhere. Sprint-sensitive cancellation additionally has `[overhaul-496]` and `[overhaul-523]` in `studio/src/test/overhaulSprintModuleGuardAcceptance.test.tsx` (run that file alone for those paths).
- **Initial sprint read:** run `bun run --cwd studio test -- src/test/overhaulModuleCreationFilterResolutionAcceptance.test.tsx`. `[overhaul-811]` delays initial active-sprint resolution while a module create is pending and verifies one identity, saved folder and selected tab. `[overhaul-812]` verifies that an explicit sprint-intent change cancels late setup and explicit folder retry retains that identity. Generated GraphQL fixture responses drive the public shell; these cases supplement browser evidence.
- **Creation safety:** run `bun run --cwd studio test -- src/test/overhaulModuleManagerCreationAcceptance.test.tsx`. `[overhaul-624]` rejects an unusable folder before trust and cancels trust with Escape; `[overhaul-625]` retains one created identity for folder retry; `[overhaul-629]` rejects late navigation after sprint intent changes; `[overhaul-643]` cancels the native picker without writes and prepares approved trust before model creation. These native calls are mocked. Sprint-filter intent/folder retry is also covered by `[overhaul-514]`–`[overhaul-516]` in `studio/src/test/overhaulSprintModuleCreationAcceptance.test.tsx`.
- **Intended desktop seam, currently stale:** `bun run --cwd studio test:e2e:desktop` runs on macOS with Rust/Tauri, Node.js and tmux. `studio/scripts/desktop-agent-acceptance.mjs` describes an isolated folder/`Trust folder` scenario with temporary Codex configuration; the [desktop harness](../../studio/e2e-desktop/README.md) describes disposable app/provider/tmux ownership and later reload/restart checks. Its setup currently clicks the retired `+ Add Module` control before reaching trust, so this scenario is historical/intended coverage, not current passing desktop trust proof. Report this blocker if running it; use the current footer `Modules` → `New module` path for a manual isolated desktop check. Even after setup repair, the fixture cannot prove paid-provider behavior or the full trust failure matrix.
- **Coverage gaps:** `module-folder-selection` recent-folder keyboard highlighting/first-Enter behavior is exercised by the browser suite above; store tests additionally cover ordering. No existing automated UI case exhaustively exercises every inaccessible-directory refusal or the repeated-scope-change retry limit. The three-round consent limit and differing-provider canonical-target rejection are source-only. Claude/Gemini native UI trust, and folder-link replacement surviving a desktop restart, have no automated desktop coverage in the cited harness. Record these paths separately when verified manually; this map adds no behavioral tests.


## End-to-end suite

Suite: studio/e2e/features/module-folders-and-trust.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| module-folder-link | @case-folder-typed-persistence @case-folder-picker-creation | @case-folder-validation-cancel @case-folder-picker-creation | @case-folder-network-retry | @case-folder-guarded-selection | @case-folder-typed-persistence @case-folder-creation-retry @case-folder-required-recovery @case-folder-guarded-selection @case-folder-picker-creation | @case-folder-typed-persistence @case-folder-picker-creation |
| module-folder-validation | @case-folder-typed-persistence @case-folder-picker-creation | @case-folder-validation-cancel @case-folder-picker-creation | @case-folder-validation-cancel @case-folder-creation-retry @case-folder-required-recovery | @case-folder-validation-cancel @case-folder-required-recovery | @case-folder-validation-cancel @case-folder-creation-retry @case-folder-required-recovery @case-folder-picker-creation | @case-folder-validation-cancel @case-folder-creation-retry @case-folder-picker-creation |
| module-folder-selection | @case-folder-recent-selection @case-folder-typed-persistence @case-folder-picker-creation | @case-folder-validation-cancel @case-folder-picker-creation | @case-folder-network-retry | @case-folder-empty-recents | @case-folder-typed-persistence @case-folder-creation-retry @case-folder-required-recovery @case-folder-guarded-selection @case-folder-picker-creation | @case-folder-typed-persistence @case-folder-guarded-selection @case-folder-picker-creation |
| module-folder-native-picker | desktop-only: browserRuntime.nativeFolderPicker is false and pickFolder returns null | desktop-only: browserRuntime.nativeFolderPicker is false and pickFolder returns null | desktop-only: browserRuntime.nativeFolderPicker is false and pickFolder returns null | desktop-only: browserRuntime.nativeFolderPicker is false and pickFolder returns null | desktop-only: browserRuntime.nativeFolderPicker is false and pickFolder returns null | desktop-only: browserRuntime.nativeFolderPicker is false and pickFolder returns null |
| module-folder-provider-trust | desktop-only: browser runtime has no directoryTrust adapter or native trust dialog | desktop-only: browser runtime has no directoryTrust adapter or native trust dialog | desktop-only: browser runtime has no directoryTrust adapter or native trust dialog | desktop-only: browser runtime has no directoryTrust adapter or native trust dialog | desktop-only: browser runtime has no directoryTrust adapter or native trust dialog | desktop-only: browser runtime has no directoryTrust adapter or native trust dialog |
| module-folder-required | @case-folder-required-recovery @case-folder-disappeared-repair | @case-folder-required-recovery @case-folder-guarded-selection | @case-folder-required-recovery @case-folder-disappeared-repair | @case-folder-required-recovery @case-folder-guarded-selection | @case-folder-required-recovery @case-folder-guarded-selection | @case-folder-disappeared-repair @case-folder-guarded-selection |
| module-folder-retry-safety | @case-folder-creation-retry @case-folder-network-retry @case-folder-pending-cancel-safety | @case-folder-validation-cancel @case-folder-guarded-selection @case-folder-pending-cancel-safety | @case-folder-creation-retry @case-folder-network-retry @case-folder-required-recovery @case-folder-pending-cancel-safety | @case-folder-guarded-selection | @case-folder-network-retry @case-folder-creation-retry @case-folder-required-recovery @case-folder-guarded-selection @case-folder-pending-cancel-safety | @case-folder-creation-retry @case-folder-network-retry @case-folder-pending-cancel-safety |

Browser cases drive typed paths against the real Rust adapter and read authoritative
links through public GraphQL. The picker creation case proves the separate Add Module dialog; delayed-save cancellation waits at the real SetModuleLink network boundary, hides the created tab, then releases the real write and proves that late completion does not reopen or select it. The two migrated titles remain verbatim in
`studio/e2e/web-app.spec.ts` until the final migration cleanup. The invalid-folder
case uses Module Manager's inline form because CODING-2643 retired the Modules
pane entry; the picker still opens the Add Module dialog. CODING-2708's baseline recorded that stale setup
blocker, not a passing or failing outcome for the individual cases.
Native host preflight and provider trust remain desktop evidence; browser writes
still exercise Rust directory validation. The typed-path case additionally checks
that the browser exposes no picker or trust dialog.

Run `bun run --cwd studio test:e2e:feature module-folders-and-trust` for retained
evidence, and `bun run --cwd studio test:e2e:features --check` for map drift.

## Relevant code

- `studio/e2e/features/module-folders-and-trust.spec.ts`: typed folder, validation, cancellation, retries and authoritative persistence journeys.

- `studio/src/features/module-links`: link operations, cache subscription, validation and shared provider trust.
- `studio/src/features/agents/terminal/ModuleFolder.tsx` and `studio/src/features/agents/terminal/ModuleFolderSelection.tsx`: modal and shared folder controls.
- `studio/src/features/terminal-panel/ModuleFolderRequired.tsx`: refused-shell recovery surface.
- `studio/src/features/module-creation/useModuleCreation.ts`: validation/trust ordering, identity retention and navigation guards; [Module Manager](module-manager.md) covers the whole creation area.
- `studio/src/runtime/desktopDirectoryTrust.ts` and `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/commands/directory_trust.rs`: local-main-window trust command and scoped approvals.
- `studio/src-tauri/crates/worktracking/ticketry-work-management/src/module_links`: persisted links, folder preflight and resolution.
- [Context map](../../CONTEXT-MAP.md) and [Studio Language glossary](../../studio/CONTEXT.md#language) define the existing module/folder vocabulary; use those references rather than a second glossary.

## Gotchas

- The shared input's default placeholder says `Local folder (optional)`, but modal Save and inline creation require a complete nonblank path. Drive button state and the explicit form label, not the placeholder's implication.
- Desktop trust resolves canonical paths for consent; the link write carries the selected trimmed path. Do not assume the stored path is the canonical prompt text.
- Provider trust may have been saved before a later provider or link write fails; cancellation/retry does not roll those external trust settings back. Confirm only folders whose code is trusted.
- Desktop picker/host validation and durable provider writes are unavailable in browser; browser tests and mocked native acceptance cases cannot establish them. The desktop harness's retired `+ Add Module` setup selector is a current blocker, despite its README describing a successful trust journey; no current passing desktop run is claimed here. The frontend absolute-path helper accepts Windows/UNC forms, while browser creation preflight requires `/`; Windows live behavior remains unverified here.
- Wait for trust dialogs, alerts and authoritative links instead of sleeps. Under Roadmap, sprint selection introduces navigation guards; successful creation broadens the filter only after folder setup. A saved folder does not authorize reopening an explicitly closed tab.
- This entry is grounded in source and existing tests, without a live walkthrough. Stated coverage gaps remain unverified in the product until driven on the relevant surface.
