"""Claude Code lifecycle hook (ticket #499).

Claude invokes this script on its own hook events (``SessionStart``,
``UserPromptSubmit``, ``PreToolUse``, ``PostToolUse``, ``Notification``,
``PermissionRequest``, ``Stop``, ``SessionEnd``). It reads the event from stdin,
normalizes it to a shared #498 ``LifecycleEventKind``, stamps it with the
session identity, attaches Claude's own resumable session id when present, and
best-effort POSTs it to the local ``/api/lifecycle/events`` ingress. The shared
stdin -> map -> stamp -> POST machinery lives in ``_reporter``; this shim only
declares Claude's ``SPEC``.

Identity is read from the environment (``MUXED_AGENT_RUN_ID`` /
``MUXED_LIFECYCLE_URL``): Claude injects hook env vars, so the launcher sets
them there rather than baking them into the command line.

Provider-session evidence (#508): Claude carries its resumable ``--resume`` UUID
as ``session_id`` on every hook event, so the adapter captures that field when
present. A missing value is a safe no-op.

``PostToolUse`` reaffirms ``tool_use`` (it never flips to complete; only
``Stop`` does that), so an approved permission's tool clears the prior
``awaiting_input`` as it runs.
"""

try:
    from . import _reporter  # package import (pytest)
except ImportError:  # pragma: no cover - exercised only via subprocess
    import _reporter  # standalone: sys.path[0] is this script's dir

SPEC = _reporter.HookSpec(
    slug="claude",
    event_to_kind={
        "SessionStart": "session_start",
        "UserPromptSubmit": "turn_start",
        "PreToolUse": "tool_use",
        "PostToolUse": "tool_use",
        "Notification": "awaiting_input",
        "PermissionRequest": "awaiting_input",
        "Stop": "turn_complete",
        "SessionEnd": "session_end",
    },
    identity="env",
    provider_session_keys=("session_id",),
)


if __name__ == "__main__":
    _reporter.run(SPEC)
