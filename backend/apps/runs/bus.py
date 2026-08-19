"""Project status bus backed by the Channels channel layer."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from studio_server.contracts import (
    AutomationAttemptFrame,
    AutomationAttemptRecord,
    BackendSessionFrame,
)


logger = logging.getLogger(__name__)

STATUS_GROUP_FMT = "status.{project_id}"


async def publish_status(project_id: str, frame: dict) -> None:
    """Publish one already-enveloped frame to a project's status group."""

    try:
        layer = get_channel_layer()
        await layer.group_send(
            STATUS_GROUP_FMT.format(project_id=project_id),
            {"type": "status.frame", "frame": frame},
        )
    except Exception as exc:
        logger.warning("failed to publish status frame: %s", exc)


def publish_backend_session_sync(
    project_id: str,
    agent_run_id: str,
    status: Literal["exited", "lost"],
    *,
    at: str | None = None,
    exit_code: int | None = None,
) -> None:
    """Synchronous bridge for an explicit terminal outcome."""

    async_to_sync(publish_backend_session)(
        project_id,
        agent_run_id,
        status,
        at=at,
        exit_code=exit_code,
    )


async def publish_backend_session(
    project_id: str,
    agent_run_id: str,
    status: Literal["exited", "lost"],
    *,
    at: str | None = None,
    exit_code: int | None = None,
) -> None:
    """Publish an explicit server-to-tmux terminal outcome.

    ``exit_code`` travels with the ending rather than being fetched afterwards,
    so a surface that must distinguish a clean end from a failed one learns
    both facts in the same frame (#670).
    """

    frame = BackendSessionFrame(
        agent_run_id=agent_run_id,
        status=status,
        at=at or datetime.now(timezone.utc).isoformat(),
        exit_code=exit_code,
    )
    await publish_status(project_id, frame.model_dump())


async def publish_automation_attempt(
    project_id: str,
    attempt: AutomationAttemptRecord,
) -> None:
    """Publish one typed launch-attempt outcome on the existing project feed."""

    frame = AutomationAttemptFrame(
        project_id=project_id,
        attempt=attempt,
    )
    await publish_status(project_id, frame.model_dump())


async def publish_document(
    project_id: str, frame: dict, *, at: str | None = None
) -> None:
    """Carry a legacy document frame onto the versioned project feed."""

    await publish_status(
        project_id,
        {
            **frame,
            "v": 1,
            "type": "document",
            "at": at or datetime.now(timezone.utc).isoformat(),
        },
    )
