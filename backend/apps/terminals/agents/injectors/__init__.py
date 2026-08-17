"""Per-agent lifecycle + MCP config injection.

Each agent CLI wires the bundled lifecycle hook reporter differently (Claude's
inline ``--settings``, Codex's ``-c`` TOML overrides, the Gemini/agy relocated
system-settings file). One module per agent lives here; this package holds the
shared anchors they all need (the bundled-hooks directory and the default
ingress/MCP URLs).
"""

import os
import sys
from dataclasses import dataclass

# Re-exported, not restated: the hook reporter owns the ingress port and path so
# the fallback a hook uses on its own is by construction the same URL the
# launcher defaults to (#1462).
from apps.terminals.agents.hooks._reporter import (  # noqa: F401
    DEFAULT_BACKEND_PORT,
    DEFAULT_LIFECYCLE_URL,
    lifecycle_url_for_port,
)


# Bundled lifecycle hook scripts live in ``terminals/agents/hooks`` — one level
# up from this package. Resolved once so each agent module references the same
# directory regardless of where it sits.

HOOKS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "hooks")

# WorkTracker MCP has one stable loopback endpoint across standalone, web, and
# desktop launches. Keeping the fallback pinned means external MCP clients and
# agent launches can use the same URL without reading process-local metadata.

DEFAULT_MCP_PORT = 8123

DEFAULT_MCP_URL = f"http://127.0.0.1:{DEFAULT_MCP_PORT}/mcp"

# The Tauri shell publishes the absolute sandbox-safe native hook runner here.
# Source launches leave it unset and execute the bundled Python shim directly.

PACKAGED_HOOK_RUNNER_ENV = "MUXED_PACKAGED_HOOK_RUNNER"
HOOK_SPOOL_DIR_ENV = "MUXED_HOOK_SPOOL_DIR"


@dataclass(frozen=True)
class InjectedLaunch:
    """A provider transformation that also needs process environment.

    Providers with no inline settings flag write a run-scoped settings file and
    point an environment variable at it. Returning the variable name and value
    structurally — rather than pre-encoding a shell ``env`` wrapper into the
    argv — spares the caller from parsing it back apart.
    """

    argv: tuple[str, ...]
    environment: dict[str, str]


def hook_argv(
    slug: str,
    script_path: str,
    *arguments: str,
    lifecycle_token: str | None = None,
) -> list[str]:
    """Return the source-Python or packaged multi-call hook command.

    :param lifecycle_token: Run-scoped Bearer credential the source-Python
        reporter presents to the lifecycle ingress. Deliberately omitted from
        the packaged runner's argv: its spool transport never POSTs (the
        backend drains the spool in-process), and the native runner rejects
        flags it does not know.
    """

    packaged_runner = os.getenv(PACKAGED_HOOK_RUNNER_ENV)
    if packaged_runner:
        command = [packaged_runner, "hook", slug]
        hook_spool_dir = os.getenv(HOOK_SPOOL_DIR_ENV)
        if hook_spool_dir:
            command.extend(["--spool-dir", hook_spool_dir])
        return [*command, *arguments]
    token_arguments = (
        ["--lifecycle-token", lifecycle_token] if lifecycle_token else []
    )
    return [sys.executable, script_path, *arguments, *token_arguments]
