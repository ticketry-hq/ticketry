"""Application operations for document discovery, serving, and fs completion.

Ported from ``web/backend/api/workspace.py``:

- ``GET /api/documents`` lists a workspace's registered documents and
  rescans their directories so files written without a live watcher are
  still discovered.
- ``GET /api/docs/{doc_id}/{asset_path}`` serves a registered document or
  one of its relative assets, validated against the registered boundary.
- ``PUT /api/docs/{doc_id}`` atomically saves the registered primary Markdown
  document when its content digest is current.
- ``GET /api/fs/complete`` autocompletes filesystem directories.

DRF owns HTTP validation and response construction. These operations resolve
application-level inputs and delegate discovery/serve/complete mechanics to
:mod:`apps.documents.service`.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Optional

from pydantic import BaseModel

from apps.errors import ApplicationError
from apps.documents import service


class SaveDocumentIn(BaseModel):
    content: str
    digest: str


@dataclass(frozen=True)
class DocumentAsset:
    content: bytes
    media_type: str
    etag: str | None


@dataclass(frozen=True)
class SavedDocument:
    digest: str
    conflict: bool


async def list_documents(
    task_id: Optional[str] = None,
    scope: Optional[str] = None,
    project_id: Optional[str] = None,
    module_id: Optional[str] = None,
    profile: Optional[int] = None,
):
    """List a workspace's design documents, rescanning their directories.

    Two addressing modes: a real ``task_id``, or ``scope=scratch`` with a
    ``module_id`` for the plan/instant bucket.
    """

    if scope == "scratch":
        if not module_id:
            raise ApplicationError(
                400, "module_id_required", code="module_id_required"
            )
        documents = await service.list_scratch_documents(module_id)
        return {"documents": documents}

    if not task_id:
        raise ApplicationError(400, "task_id_required", code="task_id_required")

    documents = await service.list_task_documents(
        task_id, project_id=project_id, module_id=module_id, profile=profile
    )
    return {"documents": documents}


async def read_document_asset(doc_id: str, asset_path: str) -> DocumentAsset:
    """Serve a registered document or one of its relative assets.

    The path-style URL mirrors the document's directory levels, so relative
    references inside the HTML resolve under the same prefix. Traversal,
    symlink escapes, unregistered documents and disallowed types are all a
    uniform 404.
    """

    result = await service.read_document_asset(doc_id, asset_path)
    if result is None:
        raise ApplicationError(404, "not_found", code="not_found")

    content, media_type = result
    etag = hashlib.sha256(content).hexdigest() if media_type == "text/markdown" else None
    return DocumentAsset(content=content, media_type=media_type, etag=etag)


async def save_document(doc_id: str, payload: SaveDocumentIn) -> SavedDocument:
    """Digest-guarded save of a registered primary Markdown document."""

    result = await service.save_primary_markdown(
        doc_id, payload.content.encode("utf-8"), payload.digest
    )
    if result is None:
        raise ApplicationError(404, "not_found", code="not_found")
    return SavedDocument(
        digest=result.digest,
        conflict=result.status == "conflict",
    )


async def fs_complete(path: str = ""):
    return {"entries": service.complete_directories(path)}
