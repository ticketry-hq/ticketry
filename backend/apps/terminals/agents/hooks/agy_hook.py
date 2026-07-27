"""Antigravity (agy) CLI lifecycle hook (ticket #502).

Antigravity's ``agy`` CLI invokes this script on its own hook events
(``SessionStart``, ``PreToolUse``, ``PostToolUse``, ``Notification``, ``Stop``,
``SessionEnd``). It reads the event from stdin, normalizes it to a shared #498
``LifecycleEventKind``, stamps it with the run identity, attaches agy's native
resumable conversation id when present, and best-effort POSTs it to the local
``/api/lifecycle/events`` ingress. The shared machinery lives in ``_reporter``;
this shim only declares agy's ``SPEC``.

Like Gemini, ``agy`` exposes a genuine end-of-turn event (``Stop``, which
carries a ``fullyIdle`` flag), so completion is reported honestly rather than
inferred from inactivity — detection confidence is HIGH. ``PostToolUse``
reaffirms ``tool_use`` (only ``Stop`` flips to complete); ``Notification`` is
the best-effort needs-input proxy until the richer statusLine surface is wired.

Identity is passed via argv: the launcher bakes ``--agent-run-id`` /
``--lifecycle-url`` into the command line, mirroring Codex and Gemini.

Provider-session evidence (#509): local ``agy`` 1.0.3 exposes ``--conversation``
for resuming by id. Existing ``history.jsonl`` stores that value as
``conversationId``, conversation files are named ``<conversationId>.pb``, and
CLI logs say ``Created conversation <uuid>``. The adapter therefore captures
only explicit ``conversationId`` / ``conversation_id`` fields. It deliberately
IGNORES generic ``sessionId`` / ``session_id`` fields because agy's binary also
carries internal language-server session ids that are not proven resumable
conversation ids. A missing conversation id is a safe no-op.

The reporter prints nothing to stdout: ``agy`` parses hook stdout as JSON and
any stray output would be treated as a hook decision.
"""

try:
    from . import _reporter  # package import (pytest)
except ImportError:  # pragma: no cover - exercised only via subprocess
    import _reporter  # standalone: sys.path[0] is this script's dir

SPEC = _reporter.HookSpec(
    slug="agy",
    event_to_kind={
        "SessionStart": "session_start",
        "PreToolUse": "tool_use",
        "PostToolUse": "tool_use",
        "Notification": "awaiting_input",
        "Stop": "turn_complete",
        "SessionEnd": "session_end",
    },
    identity="argv",
    provider_session_keys=("conversationId", "conversation_id"),
)


if __name__ == "__main__":
    _reporter.run(SPEC)
