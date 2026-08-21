"""Codex lifecycle + MCP injection (ticket #500).

Codex's ``-c key=value`` flag overrides config for one invocation and parses
the value as TOML, so the whole hooks table is passed inline without ever
editing the user's ``~/.codex`` config.
"""

import os
import shlex

from apps.terminals.agents.injectors import (
    DEFAULT_LIFECYCLE_URL,
    DEFAULT_MCP_URL,
    HOOKS_DIR,
    hook_argv,
)
from apps.terminals.authorization import issue_run_authorization


# Absolute path to the bundled Codex lifecycle hook script.

_CODEX_HOOK_PATH = os.path.join(HOOKS_DIR, "codex_hook.py")

# Codex hook events wired to the lifecycle reporter.

_CODEX_HOOK_EVENTS = (
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop",
)


def build_codex_lifecycle_hooks(agent_run_id: str, lifecycle_url: str) -> dict:
    """Build the Codex ``hooks`` table mapping wired events to the reporter.

    Produces the hooks map Codex consumes (event name -> matcher groups ->
    command handlers). Codex injects no hook environment, so this run's identity
    is baked into the hook *command* itself (``--agent-run-id`` /
    ``--lifecycle-url``) rather than passed via the environment.

    :param agent_run_id: Durable id stamped onto every reported event.
    :param lifecycle_url: Ingress URL the hook posts events to.
    :return: A dict keyed by Codex event name, each a list with one handler
        group, suitable to serialize as the ``hooks`` config value.
    """

    # Run the hook with the current interpreter so no PATH lookup is needed.

    command = shlex.join(
        hook_argv(
            "codex",
            _CODEX_HOOK_PATH,
            "--agent-run-id",
            agent_run_id,
            "--lifecycle-url",
            lifecycle_url,
            lifecycle_token=issue_run_authorization(agent_run_id),
        )
    )
    hook_entry = {"hooks": [{"type": "command", "command": command, "timeout": 5}]}

    return {event: [hook_entry] for event in _CODEX_HOOK_EVENTS}


def build_codex_mcp_servers(mcp_url: str, mcp_authorization: str) -> dict:
    """Build the Codex ``mcp_servers`` config table for WorkTracker MCP."""

    return {
        "worktracker-agent": {
            "url": mcp_url,
            "http_headers": {"Authorization": mcp_authorization},
        }
    }


def _to_toml_inline(value) -> str:
    """Serialize a JSON-like value as a TOML inline expression.

    Handles the small subset the Codex hooks table needs: nested dicts become
    inline tables (``{k=v,...}``), lists become arrays, strings get basic-string
    escaping, and ints/bools pass through. Used because Codex parses ``-c
    key=value`` as TOML, not JSON, so a JSON object value is silently treated as
    a literal string and rejected as the wrong type.
    """

    if isinstance(value, dict):
        body = ",".join(f"{k}={_to_toml_inline(v)}" for k, v in value.items())
        return "{" + body + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_to_toml_inline(v) for v in value) + "]"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    # Strings: TOML basic string — escape backslash and double-quote.
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def inject_codex_lifecycle_settings(
    argv: list[str],
    agent_run_id: str,
    lifecycle_url: str = DEFAULT_LIFECYCLE_URL,
    mcp_url: str | None = DEFAULT_MCP_URL,
) -> list[str]:
    """Splice invocation-level lifecycle hooks and MCP config into Codex.

    Codex's ``-c key=value`` flag overrides config for that invocation only and
    parses the value as TOML, so the whole hooks table is passed inline as a TOML
    inline table without ever editing the user's ``~/.codex`` config.
    ``approvals_reviewer="auto_review"`` makes the reviewer explicit for
    Ticketry's autonomous Codex sessions. ``PermissionRequest`` is reported as
    its own lifecycle state so auto-review remains visible without claiming the
    agent needs human input.
    ``--dangerously-bypass-hook-trust`` lets the freshly injected hook run
    non-interactively. The Codex adapter is the sole caller, so agent routing
    is already complete before this provider-specific transformation runs.

    :param argv: The agent launch command from
        :func:`terminals.agents.commands.get_agent_command`.
    :param agent_run_id: Durable id for this run's lifecycle events.
    :param lifecycle_url: Ingress URL the hook posts events to.
    :return: The argv with ``-c hooks=<toml>`` and the trust-bypass flag
        inserted after the executable.
    """

    hooks = build_codex_lifecycle_hooks(agent_run_id, lifecycle_url)
    hooks_toml = _to_toml_inline(hooks)
    injected = ["-c", f"hooks={hooks_toml}"]
    if mcp_url is not None:
        authorization = issue_run_authorization(agent_run_id)
        mcp_servers_toml = _to_toml_inline(
            build_codex_mcp_servers(mcp_url, authorization)
        )
        injected += ["-c", f"mcp_servers={mcp_servers_toml}"]
    injected += [
        "-c",
        'approvals_reviewer="auto_review"',
        "--dangerously-bypass-hook-trust",
    ]

    # Resume parses its own options after the subcommand, so keep the injected
    # config there and preserve the session id positional argument.
    if len(argv) > 1 and argv[1] == "resume":
        return [argv[0], argv[1], *injected, *argv[2:]]

    # Insert right after the executable so Codex's own flags still follow.

    return [argv[0], *injected, *argv[1:]]
