"""Gemini lifecycle and WorkTracker MCP injection.

Gemini has no inline settings flag, but it lets the *system* settings layer be
relocated via ``GEMINI_CLI_SYSTEM_SETTINGS_PATH``. The hooks are written to a
temp settings file and that variable is pointed at it for one launch, so the
user's ``~/.gemini/settings.json`` is never touched.
"""

import os
import shlex
import tempfile
from pathlib import Path

from apps.terminals.agents.injectors import DEFAULT_LIFECYCLE_URL, HOOKS_DIR, hook_argv
from apps.terminals.agents.injectors import DEFAULT_MCP_URL, InjectedLaunch
from apps.terminals.authorization import issue_run_authorization
from studio_server.atomic_files import atomic_write_json


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


def build_gemini_mcp_servers(mcp_url: str, mcp_authorization: str) -> dict:
    """Build Gemini's authenticated WorkTracker MCP settings entry."""

    return {
        "worktracker-agent": {
            "httpUrl": mcp_url,
            "trust": True,
            "headers": {"Authorization": mcp_authorization},
        }
    }


def inject_gemini_launch(
    argv: list[str],
    agent_run_id: str,
    *,
    lifecycle_url: str = DEFAULT_LIFECYCLE_URL,
    mcp_url: str = DEFAULT_MCP_URL,
    settings_path: Path | None = None,
) -> InjectedLaunch:
    """Splice an invocation-level lifecycle hooks override into a Gemini command.

    Gemini has no inline settings flag (unlike Claude's ``--settings`` or Codex's
    ``-c``), but it lets the *system* settings layer be relocated via the
    ``GEMINI_CLI_SYSTEM_SETTINGS_PATH`` environment variable. The hooks are
    written to a temporary settings file and that variable is pointed at it for
    this launch only, so the user's ``~/.gemini/settings.json`` is never touched
    and the hooks still merge in as an additional layer. The system layer is
    admin-managed and not trust-fingerprinted like project hooks; ``--skip-trust``
    additionally lets the freshly wired hooks run in this non-interactive
    session. The Gemini adapter is the sole caller, so agent routing is already
    complete before this provider-specific transformation runs.

    :param argv: The agent launch command from
        :func:`terminals.agents.commands.get_agent_command`.
    :param agent_run_id: Durable id for this run's lifecycle events.
    :param lifecycle_url: Ingress URL the hook posts events to.
    :return: The argv with ``--skip-trust`` spliced in, plus the settings-file
        environment variable.
    """

    settings = build_gemini_lifecycle_settings(agent_run_id, lifecycle_url)
    authorization = issue_run_authorization(agent_run_id)
    settings["mcpServers"] = build_gemini_mcp_servers(mcp_url, authorization)

    # Persist the hooks to a temp settings file for this run; it must outlive
    # this call since Gemini reads it on startup, so it is not auto-deleted.

    if settings_path is None:
        # mkstemp only mints the unique private name here; the write itself
        # goes through the same atomic path as the explicit-path branch, so
        # the two branches agree about permissions.
        descriptor, raw_settings_path = tempfile.mkstemp(
            prefix=f"Muxed-gemini-{agent_run_id}-", suffix=".json"
        )
        os.close(descriptor)
        settings_path = Path(raw_settings_path)
    atomic_write_json(settings_path, settings, separators=(",", ":"), mode=0o600)

    # Relocate the system settings layer for this process only, then trust the
    # workspace so the wired hooks execute without an interactive prompt.

    return InjectedLaunch(
        argv=(argv[0], "--skip-trust", *argv[1:]),
        environment={"GEMINI_CLI_SYSTEM_SETTINGS_PATH": str(settings_path)},
    )


def inject_gemini_lifecycle_settings(
    argv: list[str],
    agent_run_id: str,
    lifecycle_url: str = DEFAULT_LIFECYCLE_URL,
    mcp_url: str = DEFAULT_MCP_URL,
    settings_path: Path | None = None,
) -> list[str]:
    """:func:`inject_gemini_launch` encoded as a shell ``env`` wrapper argv.

    The form callers use when they can only pass an argv and have nowhere to
    put process environment.
    """

    result = inject_gemini_launch(
        argv,
        agent_run_id,
        lifecycle_url=lifecycle_url,
        mcp_url=mcp_url,
        settings_path=settings_path,
    )
    return [
        "env",
        *(f"{name}={value}" for name, value in result.environment.items()),
        *result.argv,
    ]
