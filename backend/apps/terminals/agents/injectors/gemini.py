"""Gemini lifecycle injection (ticket #501).

Gemini has no inline settings flag, but it lets the *system* settings layer be
relocated via ``GEMINI_CLI_SYSTEM_SETTINGS_PATH``. The hooks are written to a
temp settings file and that variable is pointed at it for one launch, so the
user's ``~/.gemini/settings.json`` is never touched.
"""

import json
import os
import shlex
import tempfile

from apps.terminals.agents.injectors import DEFAULT_LIFECYCLE_URL, HOOKS_DIR, hook_argv


# Absolute path to the bundled Gemini lifecycle hook script.

_GEMINI_HOOK_PATH = os.path.join(HOOKS_DIR, "gemini_hook.py")

# Gemini hook events wired to the lifecycle reporter. AfterAgent is Gemini's
# genuine end-of-turn event, so completion is reported, not inferred.

_GEMINI_HOOK_EVENTS = (
    "SessionStart",
    "BeforeAgent",
    "BeforeTool",
    "AfterTool",
    "Notification",
    "AfterAgent",
    "SessionEnd",
)

# Gemini hook timeouts are specified in milliseconds (Claude/Codex use seconds).

_GEMINI_HOOK_TIMEOUT_MS = 5000


def build_gemini_lifecycle_settings(agent_run_id: str, lifecycle_url: str) -> dict:
    """Build the Gemini ``settings.json`` payload wiring the lifecycle hooks.

    Produces a settings object whose ``hooks`` table maps each wired Gemini
    event to the bundled :mod:`terminals.agents.hooks.gemini_hook` reporter. Gemini
    runs hooks with a sanitized environment, so this run's identity is baked
    into the hook *command* itself (``--agent-run-id`` / ``--lifecycle-url``)
    rather than passed via the environment, mirroring the Codex adapter.

    :param agent_run_id: Durable id stamped onto every reported event.
    :param lifecycle_url: Ingress URL the hook posts events to.
    :return: A settings dict with a ``hooks`` key, ready to serialize to the
        file referenced by ``GEMINI_CLI_SYSTEM_SETTINGS_PATH``.
    """

    # Run the hook with the current interpreter so no PATH lookup is needed.

    command = shlex.join(
        hook_argv(
            "gemini",
            _GEMINI_HOOK_PATH,
            "--agent-run-id",
            agent_run_id,
            "--lifecycle-url",
            lifecycle_url,
        )
    )
    hook_group = {
        "hooks": [
            {"type": "command", "command": command, "timeout": _GEMINI_HOOK_TIMEOUT_MS}
        ]
    }

    return {"hooks": {event: [hook_group] for event in _GEMINI_HOOK_EVENTS}}


def inject_gemini_lifecycle_settings(
    argv: list[str],
    agent_run_id: str,
    lifecycle_url: str = DEFAULT_LIFECYCLE_URL,
) -> list[str]:
    """Splice an invocation-level lifecycle hooks override into a Gemini command.

    Gemini has no inline settings flag (unlike Claude's ``--settings`` or Codex's
    ``-c``), but it lets the *system* settings layer be relocated via the
    ``GEMINI_CLI_SYSTEM_SETTINGS_PATH`` environment variable. The hooks are
    written to a temporary settings file and that variable is pointed at it for
    this launch only, so the user's ``~/.gemini/settings.json`` is never touched
    and the hooks still merge in as an additional layer. The system layer is
    admin-managed and not trust-fingerprinted like project hooks; ``--skip-trust``
    additionally lets the freshly wired hooks run in this non-interactive
    session. Only the Gemini command is augmented; any other agent's argv is
    returned unchanged.

    :param argv: The agent launch command from
        :func:`terminals.agents.commands.get_agent_command`.
    :param agent_run_id: Durable id for this run's lifecycle events.
    :param lifecycle_url: Ingress URL the hook posts events to.
    :return: The argv prefixed with an ``env GEMINI_CLI_SYSTEM_SETTINGS_PATH=...``
        wrapper and ``--skip-trust``, or the original argv for non-Gemini agents.
    """

    if not argv or argv[0] != "gemini":
        return argv

    settings = build_gemini_lifecycle_settings(agent_run_id, lifecycle_url)

    # Persist the hooks to a temp settings file for this run; it must outlive
    # this call since Gemini reads it on startup, so it is not auto-deleted.

    fd, settings_path = tempfile.mkstemp(
        prefix=f"Muxed-gemini-{agent_run_id}-", suffix=".json"
    )
    with os.fdopen(fd, "w") as handle:
        json.dump(settings, handle, separators=(",", ":"))

    # Relocate the system settings layer for this process only, then trust the
    # workspace so the wired hooks execute without an interactive prompt.

    return [
        "env",
        f"GEMINI_CLI_SYSTEM_SETTINGS_PATH={settings_path}",
        argv[0],
        "--skip-trust",
        *argv[1:],
    ]
