"""Claude lifecycle + MCP injection (ticket #499).

Claude takes an inline ``--settings`` object that merges on top of the user's
settings hierarchy, plus an inline ``--mcp-config`` — so nothing on disk is
touched.
"""

import json
import os
import shlex

from apps.terminals.agents.injectors import (
    DEFAULT_LIFECYCLE_URL,
    DEFAULT_MCP_URL,
    HOOKS_DIR,
    hook_argv,
)
from apps.terminals.authorization import issue_run_authorization


# Absolute path to the bundled Claude lifecycle hook script.

_CLAUDE_HOOK_PATH = os.path.join(HOOKS_DIR, "claude_hook.py")

# Claude hook events wired to the lifecycle reporter.

_CLAUDE_HOOK_EVENTS = (
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Notification",
    "PermissionRequest",
    "Stop",
    "SessionEnd",
)


def build_claude_lifecycle_settings(agent_run_id: str, lifecycle_url: str) -> dict:
    """Build the inline Claude ``--settings`` payload for lifecycle hooks.

    Produces an *additional* settings object (loaded via ``--settings``) that
    Claude merges on top of the user/project settings hierarchy, so existing
    hooks are never clobbered. The ``env`` block carries this run's identity
    and its run-scoped ingress credential down to the hook subprocess; the
    ``hooks`` block points every wired event at the bundled
    :mod:`terminals.agents.hooks.claude_hook` reporter.

    :param agent_run_id: Durable id stamped onto every reported event.
    :param lifecycle_url: Ingress URL the hook posts events to.
    :return: A settings dict with ``env`` and ``hooks`` keys.
    """

    # Run the hook with the current interpreter so no PATH lookup is needed.

    command = shlex.join(hook_argv("claude", _CLAUDE_HOOK_PATH))
    hook_entry = {"hooks": [{"type": "command", "command": command, "timeout": 5}]}

    return {
        "env": {
            "MUXED_AGENT_RUN_ID": agent_run_id,
            "MUXED_LIFECYCLE_URL": lifecycle_url,
            "MUXED_LIFECYCLE_TOKEN": issue_run_authorization(agent_run_id),
        },
        "hooks": {event: [hook_entry] for event in _CLAUDE_HOOK_EVENTS},
    }


def build_claude_mcp_config(mcp_url: str, mcp_authorization: str) -> dict:
    """Build the inline Claude ``--mcp-config`` payload for WorkTracker MCP."""

    server = {
        "type": "http",
        "url": mcp_url,
        "headers": {"Authorization": mcp_authorization},
    }
    return {"mcpServers": {"worktracker-agent": server}}


def inject_claude_lifecycle_settings(
    argv: list[str],
    agent_run_id: str,
    lifecycle_url: str = DEFAULT_LIFECYCLE_URL,
    mcp_url: str = DEFAULT_MCP_URL,
) -> list[str]:
    """Splice inline lifecycle and MCP config into a Claude launch command.

    The Claude adapter is the sole caller, so agent routing is already complete
    before this provider-specific transformation runs.

    :param argv: The agent launch command from
        :func:`terminals.agents.commands.get_agent_command`.
    :param agent_run_id: Durable id for this run's lifecycle events.
    :param lifecycle_url: Ingress URL the hook posts events to.
    :param mcp_url: WorkTracker MCP HTTP endpoint.
    :return: The argv with ``--settings <json>`` inserted after the executable.
    """

    settings = build_claude_lifecycle_settings(agent_run_id, lifecycle_url)
    settings_json = json.dumps(settings, separators=(",", ":"))
    authorization = issue_run_authorization(agent_run_id)
    mcp_json = json.dumps(
        build_claude_mcp_config(mcp_url, authorization), separators=(",", ":")
    )

    # Insert right after the executable so Claude's own flags still follow.

    return [argv[0], "--settings", settings_json, "--mcp-config", mcp_json, *argv[1:]]
