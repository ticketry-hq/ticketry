# Terminal foreground selectors subscribe to the entire registry

Priority: P2. Effort: Small to medium. Category: Performance and guideline violation.

## Evidence

- [studio/src/features/agents/terminal/internal/foregroundStore.ts](../../studio/src/features/agents/terminal/internal/foregroundStore.ts), line 85, `const state = useSyncExternalStore`.
- [studio/src/features/agents/terminal/internal/foregroundStore.ts](../../studio/src/features/agents/terminal/internal/foregroundStore.ts), line 22, `let claims:`.
- [studio/src/features/agents/terminal/Terminal.tsx](../../studio/src/features/agents/terminal/Terminal.tsx), line 234, `const registerHost = useTerminalForegroundStore`.
- [studio/src/features/agents/terminal/internal/useTerminalOwnership.ts](../../studio/src/features/agents/terminal/internal/useTerminalOwnership.ts), line 11, `const claims = useTerminalForegroundStore`.

## Why change it

The hook observes the whole `snapshot` and runs its selector afterward. Every publication changes the snapshot identity, so consumers selecting stable actions also rerender when any host or claim changes. Ownership consumers subscribe to all claims instead of their own terminal. The module also keeps the client-visible claims in a standalone mutable store, contrary to the Apollo ownership rule. HTMLElement references are runtime handles and should be treated separately from those claims.

## Smallest useful refactor

Move serializable foreground claims into the existing Apollo local-state mechanism and subscribe by terminal key. Keep DOM host references in a focused runtime registry. Action-only callers should not subscribe to host or claim changes. At minimum, fix selector-level equality before attempting wider terminal changes.

## Validation

Count renders for two terminal owners and an action-only consumer. Updating one claim must leave unrelated consumers unchanged. Preserve claim transfer, owner teardown, and run rekeying in terminal ownership acceptance cases. Do not alter tmux or persisted session identity.
