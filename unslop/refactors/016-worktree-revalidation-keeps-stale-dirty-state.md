# Worktree revalidation keeps the dirty state from before the GitHub request

Status: implemented. Only checkout identity and HEAD are captured before the provider wait. Mutable Git facts and changed files are read after reacquiring the lock. A real repository test pauses the provider, verifies local status remains available, stages a file, and confirms the final response is dirty with cleanup blocked.

The review evidence below records the pre-fix behavior.

Priority: P2. Follow-up review of finding 007.

## Evidence

[service.rs](../../studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/service.rs), lines 89 to 116, rechecks the row and HEAD after reacquiring the repository lock, then passes the earlier facts.dirty to lifecycle reconciliation and returns the earlier files. [lifecycle.rs](../../studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/lifecycle.rs) uses dirty state to decide cleanup eligibility.

## Why change it

Read a clean checkout with an integrated PR, pause the GitHub response, then edit or stage a file without committing. Neither the row nor HEAD changes, so verification succeeds. The response can still report clean, omit the new changes, and offer cleanup once the owner is Done. Cleanup execution may independently recheck; this finding establishes incorrect presentation and eligibility, not data loss.

## Smallest useful refactor

Refresh local status and dependent Git calculations under the reacquired lock before constructing lifecycle state and the response. Continue checking PR and checkout identity. Share each status observation across its calculations, but do not reuse one across an unlocked interval as current state.

## Validation

Add the deferred-provider concurrency case requested in 007. Verify that another local operation can proceed during the remote wait, then modify the checkout without changing HEAD. The returned dirty state and file list must include the modification, and cleanup must be blocked. Existing changes tests passed but do not exercise this interleaving.
