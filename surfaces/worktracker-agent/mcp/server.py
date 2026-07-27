from pathlib import Path
import sys

from worktracker_agent.mcp.termination import terminate_current_run


def _import_fastmcp():
    project_root = str(Path(__file__).resolve().parents[1])
    removed_entries = []
    for entry in ("", project_root):
        while entry in sys.path:
            sys.path.remove(entry)
            removed_entries.append(entry)
    try:
        from fastmcp import FastMCP

        return FastMCP
    finally:
        for entry in reversed(removed_entries):
            sys.path.insert(0, entry)


FastMCP = _import_fastmcp()
from worktracker_agent.mcp.tools_adapter import generate_worktracker_tools  # noqa: E402

# Initialize FastMCP
mcp = FastMCP("worktracker-agent")


def mcp_ping() -> dict[str, str]:
    """Verify MCP transport and tool execution without touching a backend."""
    return {"status": "ok", "server": "worktracker-agent"}


mcp.tool(mcp_ping, name="mcp_ping")
mcp.tool(terminate_current_run, name="terminate_current_run")

# Register tools dynamically
for tool_name, tool_fn in generate_worktracker_tools():
    mcp.tool(tool_fn, name=tool_name)
