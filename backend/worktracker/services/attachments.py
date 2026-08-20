"""Application operations for work-item attachment resources."""

import uuid

from worktracker.models import Attachment
from worktracker.services.work_items import get_issue


def list_attachments(issue_id):
    """Return one work item's attachments in stable creation order."""

    get_issue(issue_id)
    return Attachment.objects.filter(issue_id=issue_id).order_by("created_at", "id")


def create_attachment(issue_id, uploaded, *, filename=None):
    """Persist one uploaded file against an existing work item."""

    issue = get_issue(issue_id)
    return Attachment.objects.create(
        id=uuid.uuid4(),
        issue=issue,
        file=uploaded,
        filename=filename or uploaded.name,
        mime_type=uploaded.content_type or "",
        size=uploaded.size,
    )
