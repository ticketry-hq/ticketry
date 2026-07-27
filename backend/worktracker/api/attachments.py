import uuid
from typing import Optional

from django.shortcuts import get_object_or_404
from ninja import File, Form
from ninja.files import UploadedFile

from worktracker.api.router import router
from worktracker.models import Attachment, Issue
from worktracker.schemas import AttachmentOut


@router.post(
    "/work-items/{issue_id}/attachments",
    response=AttachmentOut,
    operation_id="uploadAttachment",
    tags=["Attachments"],
)
def upload_attachment(
    request,
    issue_id: uuid.UUID,
    file: UploadedFile = File(...),
    name: Optional[str] = Form(None),
):
    """Store a multipart upload to local disk and record its metadata (C6)."""

    issue = get_object_or_404(Issue, pk=issue_id)

    return Attachment.objects.create(
        id=uuid.uuid4(),
        issue=issue,
        file=file,
        filename=name or file.name,
        mime_type=file.content_type or "",
        size=file.size,
    )
