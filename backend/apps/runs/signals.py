"""Adapt committed work-item state changes onto the project status feed."""

from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from django.dispatch import receiver

from apps.runs.bus import publish_status
from apps.runs.projections import work_item_state_frame
from studio_server.contracts import WorkflowStateFrame
from worktracker.models import State
from worktracker.signals import issue_state_changed, workflow_state_changed


logger = logging.getLogger(__name__)


@receiver(
    workflow_state_changed,
    dispatch_uid="runs_publish_authoritative_workflow_state",
)
def publish_authoritative_workflow_state(
    *, project_id: str, state: dict, updated_at: str, **kwargs
) -> None:
    """Publish one committed catalog row to every active project client."""

    try:
        frame = WorkflowStateFrame(
            project_id=project_id,
            state=state,
            updated_at=updated_at,
        )
        async_to_sync(publish_status)(project_id, frame.model_dump())
    except Exception:
        logger.exception(
            "failed to publish committed workflow state state=%s", state.get("id")
        )


@receiver(issue_state_changed, dispatch_uid="runs_publish_work_item_state")
def publish_work_item_state(
    *,
    issue_id: str,
    project_id: str,
    to_state_id: str | None,
    revision: int,
    updated_at: str,
    **kwargs,
) -> None:
    """Publish the durable post-commit state projection without affecting the write.

    ``issue_state_changed`` itself is emitted only after commit and uses robust
    dispatch. This receiver deliberately reads the committed row, then treats
    feed publication as best-effort: a failed channel layer must never alter an
    already-successful workflow transition.

    Every field above is part of the documented ``issue_state_changed`` payload
    and is always sent, so they are required rather than defaulted. A caller
    that omits one gets a logged failure, not a silent skip. ``to_state_id`` is
    the one genuinely nullable field — a work item can move to no state.
    """

    try:
        state = (
            State.objects.get(pk=to_state_id, project_id=project_id)
            if to_state_id is not None
            else None
        )
        frame = work_item_state_frame(
            project_id=project_id,
            work_item_id=issue_id,
            state=state,
            revision=revision,
            updated_at=updated_at,
        )
        async_to_sync(publish_status)(project_id, frame.model_dump())
    except Exception:
        logger.exception(
            "failed to publish committed work-item state issue=%s", issue_id
        )
