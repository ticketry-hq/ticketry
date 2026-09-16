# The minimal client-state folder owns most workspace behavior

Status: implemented. Workspace actions now live in focused module-selection, tab, navigation, expansion, selection, and status-cursor files. The composition module is 57 lines. Apollo remains the single state owner.

The review evidence below records the pre-fix behavior.

Priority: P2. Effort: Medium. Category: Guideline violation and maintainability.

## Evidence

- [studio/src/state/clientStore.ts](../../studio/src/state/clientStore.ts), line 83, `export interface ClientState`.
- [studio/src/state/clientStore.ts](../../studio/src/state/clientStore.ts), line 280, `export const useClientStore`.
- [studio/src/state/clientStore.ts](../../studio/src/state/clientStore.ts), line 108, `dialogs: DialogDescriptor[];`.

## Why change it

`clientStore.ts` is 744 lines and owns workspace tabs, module and task selection, keyboard focus, pane layout, expanded rows, multi-selection, dialogs, toasts, and status cursors. It imports modal, project, terminal, and terminal-panel behavior. This contradicts the instruction to keep state minimal and put domain behavior under its owning feature. A developer changing a toast or dialog must work in the same module as terminal navigation.

## Smallest useful refactor

Start by moving toast and dialog behavior to shell-owned modules, then move workspace state and actions to the workspace feature. Keep a temporary facade for callers while migrating imports. Continue storing application state in Apollo; do not create independently synchronized snapshots.

## Validation

Run toastStore, dialogStore, clientStore, selectionStore, and persistence tests for each extraction. Preserve workspace rekeying and navigation acceptance behavior. Split ownership in small changes so regressions have a clear source.

## Follow-up review

Partially addressed. Dialogs and toasts now have shell stores and clientStore is a facade, but [workspaceStore.ts](../../studio/src/features/workspace-state/workspaceStore.ts) remains about 700 lines combining tabs, keyboard navigation, pane persistence, row expansion, multi-selection, and status cursors. Move independent action groups into focused modules. The extraction also introduces the notification regression in [015](015-workspace-updates-notify-shell-stores.md).
