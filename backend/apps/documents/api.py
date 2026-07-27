"""HTTP endpoints for design-document discovery, serving, and fs completion.

Ported from ``web/backend/api/workspace.py``:

- ``GET /api/documents`` lists a workspace's registered documents and
  rescans their directories so files written without a live watcher are
  still discovered.
- ``GET /api/docs/{doc_id}/{asset_path}`` serves a registered document or
  one of its relative assets, validated against the registered boundary.
- ``PUT /api/docs/{doc_id}`` atomically saves the registered primary Markdown
  document when its content digest is current.
- ``GET /api/fs/complete`` autocompletes filesystem directories.

These routes are thin translators: parameter validation and response shaping
live here, while the discovery/serve/complete logic lives in
:mod:`apps.documents.service`.
"""

from __future__ import annotations

import hashlib
from typing import Optional

from django.http import HttpResponse, JsonResponse
from ninja import Router, Schema

from apps.documents import service
from worktracker.auth import ApiKeyAuth


router = Router(tags=["workspace"])


class SaveDocumentIn(Schema):
    content: str
    digest: str


def _error_response(error: str, *, status: int) -> JsonResponse:
    """Build a uniform ``{"detail": {"error": ...}}`` error response."""

    return JsonResponse(
        {"detail": {"error": error}},
        status=status,
        json_dumps_params={"separators": (",", ":")},
    )


@router.get("/documents")
async def list_documents(
    request,
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
            return _error_response("module_id_required", status=400)
        documents = await service.list_scratch_documents(module_id)
        return {"documents": documents}

    if not task_id:
        return _error_response("task_id_required", status=400)

    documents = await service.list_task_documents(
        task_id, project_id=project_id, module_id=module_id, profile=profile
    )
    return {"documents": documents}


@router.get("/docs/{doc_id}/{path:asset_path}")
async def serve_document_asset(request, doc_id: str, asset_path: str):
    """Serve a registered document or one of its relative assets.

    The path-style URL mirrors the document's directory levels, so relative
    references inside the HTML resolve under the same prefix. Traversal,
    symlink escapes, unregistered documents and disallowed types are all a
    uniform 404.
    """

    result = await service.read_document_asset(doc_id, asset_path)
    if result is None:
        return _error_response("not_found", status=404)

    content, media_type = result
    response = HttpResponse(content, content_type=media_type)
    response["Cache-Control"] = "no-store"
    response["X-Content-Type-Options"] = "nosniff"
    if media_type == "text/markdown":
        response["ETag"] = f'"{hashlib.sha256(content).hexdigest()}"'
    return response


@router.put("/docs/{doc_id}", auth=ApiKeyAuth())
async def save_document(request, doc_id: str, payload: SaveDocumentIn):
    """Digest-guarded save of a registered primary Markdown document."""

    result = await service.save_primary_markdown(
        doc_id, payload.content.encode("utf-8"), payload.digest
    )
    if result is None:
        return _error_response("not_found", status=404)

    if result.status == "conflict":
        response = JsonResponse(
            {"detail": {"error": "conflict", "digest": result.digest}},
            status=409,
            json_dumps_params={"separators": (",", ":")},
        )
    else:
        response = JsonResponse(
            {"digest": result.digest},
            json_dumps_params={"separators": (",", ":")},
        )
    response["ETag"] = f'"{result.digest}"'
    return response


@router.get("/fs/complete")
async def fs_complete(request, path: str = ""):
    return {"entries": service.complete_directories(path)}
