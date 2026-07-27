# ADR-0002 (T810): One strict provider-session extraction rule for all four agents

Date: 2026-07-05 · Status: Accepted (grill session, CODIN-810 refinement)

## Context

Provider-session-id capture is inconsistent today: gemini and agy accept only
a **non-empty `str`** (`isinstance` check in `extract_provider_session_id`),
while claude and codex pass the raw `hook_input.get("session_id")` through —
a non-string truthy value (e.g. an int) would be POSTed as-is. A single shared
reporter wants a single rule, but the ticket's acceptance says "wire payload
byte-compatible with today".

## Decision

The shared extractor is **strict for everyone**: return the first key in
`HookSpec.provider_session_keys` whose value is a non-empty `str`, else omit
the field. Per-agent keys: claude/codex/gemini `("session_id",)`, agy
`("conversationId", "conversation_id")` — agy continues to deliberately ignore
generic `session_id` (#509 evidence: only conversation ids are resumable).

This **tightens** claude/codex behavior for the theoretical non-string case
only; every real payload carries string UUIDs, so observed wire bytes are
identical. "Byte-compatible" in the acceptance criteria is to be read modulo
this recorded tightening.

## Alternatives rejected

- **A strict/raw flag on `HookSpec`**: preserves literal byte-compat for
  garbage inputs at the cost of a spec knob with no real-world payload that
  needs it.
