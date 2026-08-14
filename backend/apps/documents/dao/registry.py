from __future__ import annotations

from typing import Optional

from django.db import IntegrityError

from apps.documents.models import DesignDocument


async def upsert_document(
    *,
    doc_id: str,
    module_id: str,
    task_id: str,
    scope: str,
    root_dir: str,
    rel_path: str,
    discovered_by_run_id: Optional[str],
    now: str,
) -> tuple[DesignDocument, bool]:
    """Register a document or refresh only its update timestamp."""

    defaults = {
        "id": doc_id,
        "module_id": module_id,
        "task_id": task_id,
        "scope": scope,
        "discovered_by_run_id": discovered_by_run_id,
        "created_at": now,
        "updated_at": now,
    }
    try:
        row, created = await DesignDocument.objects.aget_or_create(
            root_dir=root_dir,
            rel_path=rel_path,
            defaults=defaults,
        )
    except IntegrityError:
        row = await DesignDocument.objects.aget(root_dir=root_dir, rel_path=rel_path)
        created = False

    if not created:
        await DesignDocument.objects.filter(pk=row.pk).aupdate(updated_at=now)
        row.updated_at = now
    return row, created


async def get_document(doc_id: str) -> Optional[DesignDocument]:
    """Load one document row by id."""

    return await DesignDocument.objects.filter(id=doc_id).afirst()


async def get_document_root(
    *,
    task_id: str,
    module_id: str,
    rel_path: str,
) -> Optional[str]:
    """Resolve a registered document's design directory (``root_dir``) (#625).

    A doc-chat overlay run is scoped by the document's design-dir-relative
    ``rel_path``; the registry is the source of truth for where that directory
    actually lives (module folder or a worktree). Keyed by the run's bucket
    (task id, or the scratch sentinel) and module so scratch docs across modules
    don't collide.

    :return: the absolute ``root_dir``, or ``None`` when no row matches.
    """

    row = (
        await DesignDocument.objects.filter(
            task_id=task_id,
            module_id=module_id,
            rel_path=rel_path,
        )
        .order_by("-updated_at")
        .afirst()
    )
    return row.root_dir if row else None


async def delete_documents(ids: list[str]) -> int:
    """Delete stale document rows by id."""

    if not ids:
        return 0
    deleted, _ = await DesignDocument.objects.filter(id__in=ids).adelete()
    return deleted


async def list_for_task(task_id: str) -> list[DesignDocument]:
    """List a task's documents oldest-first."""

    rows = DesignDocument.objects.filter(task_id=task_id).order_by(
        "created_at", "rel_path"
    )
    return sorted([row async for row in rows], key=lambda row: row.rel_path)


async def list_for_scratch(
    module_id: str,
    scratch_task_id: str,
) -> list[DesignDocument]:
    """List one module's scratch documents oldest-first."""

    rows = DesignDocument.objects.filter(
        task_id=scratch_task_id,
        module_id=module_id,
    ).order_by("created_at", "rel_path")
    return sorted([row async for row in rows], key=lambda row: row.rel_path)
