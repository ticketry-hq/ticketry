# Scratch-agent counter has no callers

Tag: `delete`. Confidence: high for checked-in callers.

Location: `studio/src/features/agents/terminal/internal/sessionStore.ts:220-249`.

selectScratchAgentCount loops over local sessions, excludes shells and task-bound sessions, applies optional module/project filters, and counts three transport statuses. A whole-repository search finds only its definition. It is neither re-exported nor used by tests.

Delete the function and its historical comments. This removes about 30 lines of unused selection logic and two unused filtering options from an already large store module.

Validation: repeat the symbol search and run frontend typecheck. No replacement or new test is needed for an uncalled selector.
