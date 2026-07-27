"""Per-agent lifecycle + MCP config injection.

Each agent CLI wires the bundled lifecycle hook reporter differently (Claude's
inline ``--settings``, Codex's ``-c`` TOML overrides, the Gemini/agy relocated
system-settings file). One module per agent lives here; this package holds the
shared anchors they all need (the bundled-hooks directory and the default
ingress/MCP URLs).
"""

import os
import sys


# Bundled lifecycle hook scripts live in ``terminals/agents/hooks`` — one level
# up from this package. Resolved once so each agent module references the same
# directory regardless of where it sits.

HOOKS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "hooks")

# Loopback ingress the lifecycle hooks post to (ticket #499).

DEFAULT_LIFECYCLE_URL = "http://127.0.0.1:8787/api/lifecycle/events"

# WorkTracker MCP server URL injected into agent launches. Local dev uses the
# host-mapped port; deployments can override this with their service URL.

DEFAULT_MCP_URL = "http://127.0.0.1:8123/mcp"

# A frozen PyInstaller process reports the multi-call ``muxed-backend`` binary
# as ``sys.executable``.  The packaged backend publishes that executable here
# so hooks can dispatch back into its dedicated ``hook`` mode instead of trying
# to execute a non-existent source script with the backend CLI.

PACKAGED_HOOK_RUNNER_ENV = "MUXED_PACKAGED_HOOK_RUNNER"


def hook_argv(slug: str, script_path: str, *arguments: str) -> list[str]:
    """Return the source-Python or packaged multi-call hook command."""

    packaged_runner = os.getenv(PACKAGED_HOOK_RUNNER_ENV)
    if packaged_runner:
        return [packaged_runner, "hook", slug, *arguments]
    return [sys.executable, script_path, *arguments]
