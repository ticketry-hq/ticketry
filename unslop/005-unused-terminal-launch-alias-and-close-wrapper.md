# Unused terminal launch alias and close wrapper

Tag: `delete`. Confidence: high for checked-in callers.

Locations:

- `studio/src/features/agents/terminal/hooks.ts:27-29`
- `studio/src/features/agents/terminal/internal/actions.ts:30-32`
- `studio/src/features/agents/terminal/index.ts:47,97`

`launchSession` delegates unchanged to `launchAgent`, which already delegates to the session store. A source search finds no caller of `launchSession`, only its definition, export, and documentation. `closeTerminal` likewise has no caller beyond its export.

Delete both functions, their exports, the now-unused launchAgent import in hooks, and the stale barrel comment advertising launchSession. Keep launchAgent and ackTerminal, which have real callers and provide the feature boundary described in the file.

Validation: repeat a whole-repository symbol search and run frontend typecheck. This removes unused names without moving callers onto store internals.
