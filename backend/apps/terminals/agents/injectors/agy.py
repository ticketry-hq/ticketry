"""Antigravity (agy) lifecycle + MCP injection (ticket #502).

agy is the Gemini-CLI-lineage successor, so it shares Gemini's relocated
system-settings machinery: hooks (and MCP servers) are written to a temp
settings file and an env var is pointed at it for one launch.
"""

import json
import os
import shlex
import tempfile

from apps.terminals.agents.injectors import (
    DEFAULT_LIFECYCLE_URL,
    DEFAULT_MCP_URL,
    HOOKS_DIR,
    hook_argv,
)
from apps.terminals.authorization import issue_run_authorization


# Absolute path to the bundled Antigravity (agy) lifecycle hook script.

_AGY_HOOK_PATH = os.path.join(HOOKS_DIR, "agy_hook.py")

# Antigravity (agy) hook events wired to the lifecycle reporter. Stop is agy's
# genuine end-of-turn event, so completion is reported, not inferred.

_AGY_HOOK_EVENTS = (
    "SessionStart",
    "PreToolUse",
    "PostToolUse",
    "Notification",
    "Stop",
    "SessionEnd",
)

# agy is the Gemini-CLI-lineage successor, so its hook timeouts are treated as
# milliseconds like Gemini's. Unverified on a live agy (not installed here).

_AGY_HOOK_TIMEOUT_MS = 5000

# Env var agy honors to relocate its system settings layer for one launch.
# agy shares the gemini-cli settings machinery (config under ~/.gemini/...), so
# this is the best-available override. Unverified on a live agy: if the var is
# wrong, injection degrades to "no lifecycle events", never a broken session.

_AGY_SYSTEM_SETTINGS_ENV = "GEMINI_CLI_SYSTEM_SETTINGS_PATH"


def build_agy_lifecycle_settings(agent_run_id: str, lifecycle_url: str) -> dict:
    """Build the agy ``settings.json`` payload wiring the lifecycle hooks.

    Produces a settings object whose ``hooks`` table maps each wired agy event
    to the bundled :mod:`terminals.agents.hooks.agy_hook` reporter, mirroring the
    Gemini adapter (agy is the Gemini-CLI-lineage successor). The run identity
    is baked into the hook *command* itself (``--agent-run-id`` /
    ``--lifecycle-url``) rather than passed via the environment.

    :param agent_run_id: Durable id stamped onto every reported event.
    :param lifecycle_url: Ingress URL the hook posts events to.
    :return: A settings dict with a ``hooks`` key, ready to serialize to the
        file referenced by :data:`_AGY_SYSTEM_SETTINGS_ENV`.
    """

    # Run the hook with the current interpreter so no PATH lookup is needed.

    command = shlex.join(
        hook_argv(
            "agy",
            _AGY_HOOK_PATH,
            "--agent-run-id",
            agent_run_id,
            "--lifecycle-url",
            lifecycle_url,
        )
    )
    hook_group = {
        "hooks": [
            {"type": "command", "command": command, "timeout": _AGY_HOOK_TIMEOUT_MS}
        ]
    }

    return {"hooks": {event: [hook_group] for event in _AGY_HOOK_EVENTS}}


def build_agy_mcp_servers(mcp_url: str, mcp_authorization: str) -> dict:
    """Build the agy/Gemini-lineage ``mcpServers`` config for WorkTracker MCP."""

    return {
        "worktracker-agent": {
            "httpUrl": mcp_url,
            "trust": True,
            "headers": {"Authorization": mcp_authorization},
        }
    }


def inject_agy_lifecycle_settings(
    argv: list[str],
    agent_run_id: str,
    lifecycle_url: str = DEFAULT_LIFECYCLE_URL,
    mcp_url: str = DEFAULT_MCP_URL,
) -> list[str]:
    """Relocate agy's settings layer to a temp file wiring hooks and MCP.

    agy has no inline settings flag, so the hooks are written to a temporary
    settings file and :data:`_AGY_SYSTEM_SETTINGS_ENV` is pointed at it for this
    launch only — the user's real config is never touched. Unlike the Gemini
    helper, **no extra CLI flag is added**: the launch already runs with
    ``--dangerously-skip-permissions`` (which covers hook trust), and agy is not
    installed here to confirm a trust flag, so injecting an unknown flag could
    break the launch. Only the agy command is augmented; any other agent's argv
    is returned unchanged.

    :param argv: The agent launch command from
        :func:`terminals.agents.commands.get_agent_command`.
    :param agent_run_id: Durable id for this run's lifecycle events.
    :param lifecycle_url: Ingress URL the hook posts events to.
    :return: The argv prefixed with an ``env <settings-env>=...`` wrapper, or the
        original argv for non-agy agents.
    """

    if not argv or argv[0] != "agy":
        return argv

    settings = build_agy_lifecycle_settings(agent_run_id, lifecycle_url)
    authorization = issue_run_authorization(agent_run_id)
    settings["mcpServers"] = build_agy_mcp_servers(mcp_url, authorization)

    # Persist the hooks to a temp settings file for this run; it must outlive
    # this call since agy reads it on startup, so it is not auto-deleted.

    fd, settings_path = tempfile.mkstemp(
        prefix=f"Muxed-agy-{agent_run_id}-", suffix=".json"
    )
    with os.fdopen(fd, "w") as handle:
        json.dump(settings, handle, separators=(",", ":"))

    # Relocate the settings layer for this process only; add no CLI flags.

    return [
        "env",
        f"{_AGY_SYSTEM_SETTINGS_ENV}={settings_path}",
        *argv,
    ]
