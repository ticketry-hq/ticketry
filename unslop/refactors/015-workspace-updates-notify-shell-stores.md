# Workspace updates notify both unrelated shell stores

Status: implemented. The shell compatibility adapter exposes non-enumerable dialog/toast getters and forwards explicit writes only when the value changes. Acceptance case 267 verifies focus, task selection, and status cursors produce no shell-store notifications while a dialog and toast remain visible.

The review evidence below records the pre-fix behavior.

Priority: P2. Follow-up review of finding 009.

## Evidence

[workspaceStore.ts](../../studio/src/features/workspace-state/workspaceStore.ts), lines 649 to 680, forwards dialogs and toasts whenever those properties exist. Its derived state exposes both through enumerable getters. [localState.ts](../../studio/src/shared/apollo/localState.ts) spreads the previous state before calling prepare, which turns both getters into own properties on every update.

## Why change it

Selecting a tab, changing focus, or advancing a status cursor now calls setState on both shell stores, even though neither changed. Each call writes to Apollo and notifies subscribers. A temporary Vitest probe confirmed that one setFocusedPane call produces exactly one dialog-store notification and one toast-store notification. This establishes extra writes and notifications, not a measured React render increase.

## Smallest useful refactor

Forward only explicitly changed shell fields. Compare with the previous shell values, or remove the compatibility fields as callers migrate. Ordinary workspace actions should write only workspace state.

## Validation

Subscribe to both shell stores, change workspace focus and selection, and assert zero notifications. Explicit compatibility writes must still reach their shell store. The review probe was removed after execution; no application code changed.
