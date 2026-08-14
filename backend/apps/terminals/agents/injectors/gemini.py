"""Gemini lifecycle and WorkTracker MCP injection.

Gemini has no inline settings flag, but it lets the *system* settings layer be
relocated via ``GEMINI_CLI_SYSTEM_SETTINGS_PATH``. The hooks are written to a
temp settings file and that variable is pointed at it for one launch, so the
user's ``~/.gemini/settings.json`` is never touched. The machinery is shared
with agy and lives in :mod:`._system_settings`; this module is Gemini's data
plus the public names its callers use.
"""

from pathlib import Path

from apps.terminals.agents.injectors import DEFAULT_LIFECYCLE_URL, DEFAULT_MCP_URL
from apps.terminals.agents.injectors import InjectedLaunch
from apps.terminals.agents.injectors._system_settings import (
    SystemSettingsProvider,
    build_lifecycle_settings,
    build_mcp_servers,
    encode_as_env_argv,
    inject,
)

# The system settings layer is admin-managed and not trust-fingerprinted like
# project hooks; ``--skip-trust`` additionally lets the freshly wired hooks run
# in this non-interactive session. AfterAgent is Gemini's genuine end-of-turn
# event, so completion is reported, not inferred.

GEMINI = SystemSettingsProvider(
    slug="gemini",
    hook_script="gemini_hook.py",
    events=(
        "SessionStart",
        "BeforeAgent",
        "BeforeTool",
        "AfterTool",
        "Notification",
        "AfterAgent",
        "SessionEnd",
    ),
    extra_flags=("--skip-trust",),
)


def build_gemini_lifecycle_settings(agent_run_id: str, lifecycle_url: str) -> dict:
    """Build the Gemini ``settings.json`` payload wiring the lifecycle hooks."""

    return build_lifecycle_settings(GEMINI, agent_run_id, lifecycle_url)


def build_gemini_mcp_servers(mcp_url: str, mcp_authorization: str) -> dict:
    """Build Gemini's authenticated WorkTracker MCP settings entry."""

    return build_mcp_servers(mcp_url, mcp_authorization)


def inject_gemini_launch(
    argv: list[str],
    agent_run_id: str,
    *,
    lifecycle_url: str = DEFAULT_LIFECYCLE_URL,
    mcp_url: str = DEFAULT_MCP_URL,
    settings_path: Path | None = None,
) -> InjectedLaunch:
    """Splice an invocation-level lifecycle hooks override into a Gemini command."""

    return inject(
        GEMINI,
        argv,
        agent_run_id,
        lifecycle_url=lifecycle_url,
        mcp_url=mcp_url,
        settings_path=settings_path,
    )


def inject_gemini_lifecycle_settings(
    argv: list[str],
    agent_run_id: str,
    lifecycle_url: str = DEFAULT_LIFECYCLE_URL,
    mcp_url: str = DEFAULT_MCP_URL,
    settings_path: Path | None = None,
) -> list[str]:
    """:func:`inject_gemini_launch` encoded as a shell ``env`` wrapper argv."""

    return encode_as_env_argv(
        inject_gemini_launch(
            argv,
            agent_run_id,
            lifecycle_url=lifecycle_url,
            mcp_url=mcp_url,
            settings_path=settings_path,
        )
    )
