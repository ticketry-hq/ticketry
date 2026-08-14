"""Shared "relocated system settings" injection for gemini-CLI-lineage providers.

Providers with no inline settings flag (gemini, agy) write this run's hooks and
MCP servers to a run-scoped settings file and point
``GEMINI_CLI_SYSTEM_SETTINGS_PATH`` at it for one launch — the user's real
``~/.gemini/settings.json`` is never touched.

The providers differ in five values only: their slug, their bundled hook
script, the events they wire, the CLI flags they need, and (derived from the
slug) their temp-file prefix. Everything else — the settings-file write, the
MCP server entry, the hook-group shape, the env var, the timeout unit — is one
implementation here, so a fix to it is a fix to both.
"""

import os
import shlex
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from apps.terminals.agents.injectors import (
    HOOKS_DIR,
    InjectedLaunch,
    hook_argv,
)
from apps.terminals.authorization import issue_run_authorization
from studio_server.atomic_files import atomic_write_json

# Both providers relocate the same settings layer: agy shares the gemini-cli
# settings machinery, so this one variable name serves both.

SYSTEM_SETTINGS_ENV = "GEMINI_CLI_SYSTEM_SETTINGS_PATH"

# gemini-lineage hook timeouts are specified in milliseconds (Claude/Codex use
# seconds).

HOOK_TIMEOUT_MS = 5000


@dataclass(frozen=True)
class SystemSettingsProvider:
    """The five values that distinguish one gemini-lineage provider."""

    slug: str
    #: Basename of the bundled hook script inside :data:`HOOKS_DIR`.
    hook_script: str
    events: tuple[str, ...]
    #: Spliced in after ``argv[0]``. Empty leaves the argv untouched.
    extra_flags: tuple[str, ...] = field(default=())

    @property
    def hook_path(self) -> str:
        return os.path.join(HOOKS_DIR, self.hook_script)


def build_lifecycle_settings(
    provider: SystemSettingsProvider,
    agent_run_id: str,
    lifecycle_url: str,
) -> dict:
    """Build the ``settings.json`` payload wiring this provider's hooks.

    Produces a settings object whose ``hooks`` table maps each wired event to
    the provider's bundled reporter, ready to serialize to the file referenced
    by :data:`SYSTEM_SETTINGS_ENV`. These CLIs run hooks with a sanitized
    environment, so this run's identity is baked into the hook *command* itself
    (``--agent-run-id`` / ``--lifecycle-url``) rather than passed via the
    environment, mirroring the Codex adapter.
    """

    # Run the hook with the current interpreter so no PATH lookup is needed.

    command = shlex.join(
        hook_argv(
            provider.slug,
            provider.hook_path,
            "--agent-run-id",
            agent_run_id,
            "--lifecycle-url",
            lifecycle_url,
        )
    )
    hook_group = {
        "hooks": [{"type": "command", "command": command, "timeout": HOOK_TIMEOUT_MS}]
    }

    return {"hooks": {event: [hook_group] for event in provider.events}}


def build_mcp_servers(mcp_url: str, mcp_authorization: str) -> dict:
    """Build the gemini-lineage ``mcpServers`` config for WorkTracker MCP."""

    return {
        "worktracker-agent": {
            "httpUrl": mcp_url,
            "trust": True,
            "headers": {"Authorization": mcp_authorization},
        }
    }


def inject(
    provider: SystemSettingsProvider,
    argv: list[str],
    agent_run_id: str,
    *,
    lifecycle_url: str,
    mcp_url: str,
    settings_path: Path | None = None,
) -> InjectedLaunch:
    """Relocate this provider's settings layer to a file wiring hooks and MCP.

    The provider's adapter is the sole caller, so agent routing is already
    complete before this provider-specific transformation runs.

    :param argv: The agent launch command from
        :func:`terminals.agents.commands.get_agent_command`.
    :param settings_path: Run-scoped destination for the settings file. ``None``
        mints a private temp file instead.
    :return: The argv with any provider flags spliced in, plus the settings-file
        environment variable.
    """

    settings = build_lifecycle_settings(provider, agent_run_id, lifecycle_url)
    authorization = issue_run_authorization(agent_run_id)
    settings["mcpServers"] = build_mcp_servers(mcp_url, authorization)

    # Persist the hooks to a temp settings file for this run; it must outlive
    # this call since the CLI reads it on startup, so it is not auto-deleted.

    if settings_path is None:
        # mkstemp only mints the unique private name here; the write itself
        # goes through the same atomic path as the explicit-path branch, so
        # the two branches agree about permissions.
        descriptor, raw_settings_path = tempfile.mkstemp(
            prefix=f"Muxed-{provider.slug}-{agent_run_id}-", suffix=".json"
        )
        os.close(descriptor)
        settings_path = Path(raw_settings_path)
    atomic_write_json(settings_path, settings, separators=(",", ":"), mode=0o600)

    # Relocate the settings layer for this process only.

    return InjectedLaunch(
        argv=(argv[0], *provider.extra_flags, *argv[1:]),
        environment={SYSTEM_SETTINGS_ENV: str(settings_path)},
    )


def encode_as_env_argv(result: InjectedLaunch) -> list[str]:
    """Encode an :class:`InjectedLaunch` as a shell ``env`` wrapper argv.

    The form callers use when they can only pass an argv and have nowhere to
    put process environment.
    """

    return [
        "env",
        *(f"{name}={value}" for name, value in result.environment.items()),
        *result.argv,
    ]
