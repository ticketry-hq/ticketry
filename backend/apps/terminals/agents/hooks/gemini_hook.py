"""Gemini CLI lifecycle hook (ticket #501).

Gemini CLI (>= 0.41) invokes this script on its own hook events
(``SessionStart``, ``BeforeAgent``, ``BeforeTool``, ``AfterTool``,
``Notification``, ``AfterAgent``, ``SessionEnd``). It reads the event from
stdin, normalizes it to a shared #498 ``LifecycleEventKind``, stamps it with
the run identity, attaches Gemini's own resumable session id when present, and
best-effort POSTs it to the local ``/api/lifecycle/events`` ingress. The shared
machinery lives in ``_reporter``; this shim only declares Gemini's ``SPEC``.

Unlike Claude or Codex, Gemini exposes a genuine end-of-turn event
(``AfterAgent``, fired once per turn after the final response), so completion is
reported honestly rather than inferred from inactivity — detection confidence
is HIGH. ``AfterTool`` reaffirms ``tool_use`` (only ``AfterAgent`` flips to
complete); ``Notification`` covers tool-permission alerts.

Identity is passed via argv: Gemini runs hooks with a sanitized environment, so
the launcher bakes ``--agent-run-id`` / ``--lifecycle-url`` into the command.

Provider-session evidence (#510, verified against local Gemini CLI 0.41.2):
``session_id`` is part of the documented base hook input schema on every event,
and that value is the durable session UUID — it matches ``gemini
--list-sessions`` and the on-disk ``"sessionId"`` in the chat transcript, and
the CLI accepts it via ``gemini --resume {uuid}``. The adapter therefore
captures explicit ``session_id`` values; a missing value is a safe no-op.

The reporter prints nothing to stdout: Gemini parses hook stdout as JSON and
any stray output would be treated as a hook decision.
"""

try:
    from . import _reporter  # package import (pytest)
except ImportError:  # pragma: no cover - exercised only via subprocess
    import _reporter  # standalone: sys.path[0] is this script's dir

SPEC = _reporter.HookSpec(
    slug="gemini",
    event_to_kind={
        "SessionStart": "session_start",
        "BeforeAgent": "turn_start",
        "BeforeTool": "tool_use",
        "AfterTool": "tool_use",
        "Notification": "awaiting_input",
        "AfterAgent": "turn_complete",
        "SessionEnd": "session_end",
    },
    identity="argv",
    provider_session_keys=("session_id",),
)


if __name__ == "__main__":
    _reporter.run(SPEC)
