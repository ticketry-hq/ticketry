"""Zero-argument MCP surface for run self-termination."""

from __future__ import annotations

from typing import Any

from worktracker_agent.api.run_control import get_studio_run_control_service


def _request_authorization() -> str | None:
    """Return Authorization from the active FastMCP HTTP request, if any."""

    try:
        from fastmcp.server.dependencies import get_http_request

        request = get_http_request()
    except RuntimeError:
        return None
    return request.headers.get("Authorization")


def terminate_current_run() -> dict[str, Any]:
    """Terminate only the Studio run bound to this MCP request."""

    return get_studio_run_control_service().terminate_current_run(
        _request_authorization()
    )
