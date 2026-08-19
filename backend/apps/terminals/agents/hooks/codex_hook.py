"""Codex CLI lifecycle hook (ticket #500).

Codex invokes this script on its wired hook events (``SessionStart``,
``UserPromptSubmit``, ``PreToolUse``, ``PostToolUse``,
``PermissionRequest``, ``Stop``). It reads the event from stdin, normalizes it
to a shared #498
``LifecycleEventKind``, stamps it with the run identity, attaches Codex's own
resumable session id when present, and best-effort POSTs it to the local
``/api/lifecycle/events`` ingress. The shared machinery lives in ``_reporter``;
this shim only declares Codex's ``SPEC``.

Identity is passed via argv: Codex does not inject hook environment variables,
so the launcher bakes ``--agent-run-id`` / ``--lifecycle-url`` into this hook's
command line.

Provider-session evidence: Codex carries its resumable UUID as ``session_id``
on every hook event, so the adapter captures that field when present.

Codex has no ``Notification`` or ``SessionEnd`` hooks, so ``Stop`` is its only
end-of-activity signal. An open Codex terminal stops because Codex is waiting
for the user, so ``Stop`` normalizes to ``awaiting_input`` (rendered as
``needs_input`` by the shared reducer) rather than claiming a completed turn or
an exited session. ``PermissionRequest`` maps to the distinct
``permission_required`` state: Ticketry launches Codex with auto-review, so the
status exposes the review without claiming human input is needed.
``PostToolUse`` reaffirms ``tool_use`` (only ``Stop`` flips to waiting).
"""

try:
    from . import _reporter  # package import (pytest)
except ImportError:  # pragma: no cover - exercised only via subprocess
    import _reporter  # standalone: sys.path[0] is this script's dir

SPEC = _reporter.HookSpec(
    slug="codex",
    event_to_kind={
        "SessionStart": "session_start",
        "UserPromptSubmit": "turn_start",
        "PreToolUse": "tool_use",
        "PostToolUse": "tool_use",
        "PermissionRequest": "permission_required",
        "Stop": "awaiting_input",
    },
    identity="argv",
    provider_session_keys=("session_id",),
)


if __name__ == "__main__":
    _reporter.run(SPEC)
