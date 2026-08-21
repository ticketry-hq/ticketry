"""Antigravity (agy) lifecycle + MCP injection (ticket #502).

agy is the Gemini-CLI-lineage successor, so it shares Gemini's relocated
system-settings machinery: hooks (and MCP servers) are written to a temp
settings file and an env var is pointed at it for one launch. That machinery
lives in :mod:`._system_settings`; this module is agy's data plus the public
names its callers use.
"""

from pathlib import Path

from apps.terminals.agents.injectors import (
    DEFAULT_LIFECYCLE_URL,
    DEFAULT_MCP_URL,
    InjectedLaunch,
)
from apps.terminals.agents.injectors._system_settings import (
    SYSTEM_SETTINGS_ENV,
    SystemSettingsProvider,
    build_lifecycle_settings,
    build_mcp_servers,
    encode_as_env_argv,
    inject,
)

# Env var agy honors to relocate its system settings layer for one launch. agy
# shares the gemini-cli settings machinery (config under ~/.gemini/...), so the
# shared name is the best-available override.

_AGY_SYSTEM_SETTINGS_ENV = SYSTEM_SETTINGS_ENV

# Unverified on a live agy (not installed here), for this whole value: the
# settings env var above, the millisecond hook timeout, and the event names.
# If any is wrong, injection degrades to "no lifecycle events", never a broken
# session. Unlike the Gemini provider, **no extra CLI flag is added**: the
# launch already runs with ``--dangerously-skip-permissions`` (which covers
# hook trust), and injecting an unknown flag could break the launch. Stop is
# agy's genuine end-of-turn event, so completion is reported, not inferred.

AGY = SystemSettingsProvider(
    slug="agy",
    hook_script="agy_hook.py",
    events=(
        "SessionStart",
        "PreToolUse",
        "PostToolUse",
        "Notification",
        "Stop",
        "SessionEnd",
    ),
)


def build_agy_lifecycle_settings(agent_run_id: str, lifecycle_url: str) -> dict:
    """Build the agy ``settings.json`` payload wiring the lifecycle hooks."""

    return build_lifecycle_settings(AGY, agent_run_id, lifecycle_url)


def build_agy_mcp_servers(mcp_url: str, mcp_authorization: str) -> dict:
    """Build the agy/Gemini-lineage ``mcpServers`` config for WorkTracker MCP."""

    return build_mcp_servers(mcp_url, mcp_authorization)


def inject_agy_launch(
    argv: list[str],
    agent_run_id: str,
    *,
    lifecycle_url: str = DEFAULT_LIFECYCLE_URL,
    mcp_url: str | None = DEFAULT_MCP_URL,
    settings_path: Path | None = None,
) -> InjectedLaunch:
    """Relocate agy's settings layer to a temp file wiring hooks and MCP."""

    return inject(
        AGY,
        argv,
        agent_run_id,
        lifecycle_url=lifecycle_url,
        mcp_url=mcp_url,
        settings_path=settings_path,
    )


def inject_agy_lifecycle_settings(
    argv: list[str],
    agent_run_id: str,
    lifecycle_url: str = DEFAULT_LIFECYCLE_URL,
    mcp_url: str | None = DEFAULT_MCP_URL,
    settings_path: Path | None = None,
) -> list[str]:
    """:func:`inject_agy_launch` encoded as a shell ``env`` wrapper argv."""

    return encode_as_env_argv(
        inject_agy_launch(
            argv,
            agent_run_id,
            lifecycle_url=lifecycle_url,
            mcp_url=mcp_url,
            settings_path=settings_path,
        )
    )
