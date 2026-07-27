"""Studio-specific forwarding seam for current-run termination."""

from __future__ import annotations

import os
from typing import Any

import httpx


DEFAULT_RUN_CONTROL_URL = "http://127.0.0.1:8787/api/terminals/self-terminate"


class StudioRunControlService:
    """Forward caller authorization to Studio's terminal authority."""

    def __init__(
        self,
        url: str | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.url = url or os.getenv("STUDIO_RUN_CONTROL_URL") or DEFAULT_RUN_CONTROL_URL
        self._transport = transport

    def terminate_current_run(self, authorization: str | None) -> dict[str, Any]:
        if not authorization:
            return {
                "ok": False,
                "error": "caller_run_unbound",
                "reason": "authorization_missing",
            }
        try:
            with httpx.Client(timeout=10.0, transport=self._transport) as client:
                response = client.post(
                    self.url,
                    headers={"Authorization": authorization},
                )
        except httpx.RequestError as exc:
            return {
                "ok": False,
                "error": "run_control_unavailable",
                "message": str(exc),
            }
        try:
            body = response.json()
        except ValueError:
            body = None
        if not isinstance(body, dict):
            return {
                "ok": False,
                "error": "run_control_invalid_response",
                "status_code": response.status_code,
            }
        return body


def get_studio_run_control_service() -> StudioRunControlService:
    """Build a forwarding service from the current process environment."""

    return StudioRunControlService()
