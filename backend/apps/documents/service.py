"""Design-document discovery, serving, and filesystem completion.

The domain logic behind the workspace document endpoints: it reconciles the
registry against what is on disk (rescan files written without a live watcher,
prune rows whose file is gone), resolves the canonical task design directory
from owned worktracker data, validates asset requests against their registered
boundary, and autocompletes directories. :mod:`apps.documents.api` is the thin
HTTP translator over these functions.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from apps.documents import dao as documents_dao
from apps.documents import design_docs
from apps.documents.models import DesignDocument
from apps.runs import dao as runs_dao
from apps.terminals.dao import SCRATCH_TASK_ID
from apps import worktracker_queries
from apps.settings_store.config import module_link_path, resolve_profile
from studio_server.atomic_files import atomic_write_bytes


# Asset types servable from inside a registered design directory. Anything
# else — including no extension — is a uniform 404.

_ASSET_MEDIA_TYPES = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain",
    ".md": "text/markdown",
}


@dataclass(frozen=True)
class SaveDocumentResult:
    status: str
    digest: str


def doc_payload(row: DesignDocument) -> dict:
    """Shape one registry row for the wire.

    Shared with :mod:`apps.documents.watch` so a field added to the listing
    shape also reaches live watch frames.
    """

    return {
        "id": row.id,
        "rel_path": row.rel_path,
        "label": design_docs.doc_label(row.rel_path),
    }


async def _prune_missing_documents(rows: list[DesignDocument]) -> None:
    """Remove registry rows whose primary document file no longer exists."""

    stale_ids: list[str] = []
    for row in rows:
        target = Path(row.root_dir) / row.rel_path
        if not await asyncio.to_thread(target.is_file):
            stale_ids.append(row.id)
    await documents_dao.delete_documents(stale_ids)


async def _rescan_roots(
    roots: set[str],
    known: set[tuple[str, str]],
    *,
    module_id: str,
    task_id: str,
    scope: str,
) -> None:
    """Register supported documents found on disk but missing from the registry.

    The restore path's safety net: files written while no watcher was alive
    (backend restart, planning→task move, finished run) become rows here.

    :param roots: absolute design-directory boundaries to scan.
    :param known: already-registered ``(root_dir, rel_path)`` pairs.
    :param module_id: workspace module for the new rows.
    :param task_id: work-item id or the scratch sentinel.
    :param scope: scope recorded on rescan-discovered rows.
    """

    now = datetime.now(timezone.utc).isoformat()
    for root in sorted(roots):
        for rel_path in design_docs.scan_documents(Path(root)):
            if (root, rel_path) in known:
                continue
            await documents_dao.upsert_document(
                doc_id=uuid.uuid4().hex,
                module_id=module_id,
                task_id=task_id,
                scope=scope,
                root_dir=root,
                rel_path=rel_path,
                discovered_by_run_id=None,
                now=now,
            )


async def list_scratch_documents(module_id: str) -> list[dict]:
    """List the plan/instant (scratch) bucket for a module, rescanning first."""

    rows = await documents_dao.list_for_scratch(module_id, SCRATCH_TASK_ID)
    run_roots = await runs_dao.list_design_dirs_for_task(
        SCRATCH_TASK_ID, module_id=module_id
    )
    roots = {r.root_dir for r in rows} | set(run_roots)
    known = {(r.root_dir, r.rel_path) for r in rows}
    await _rescan_roots(
        roots, known, module_id=module_id, task_id=SCRATCH_TASK_ID, scope="plan"
    )
    rows = await documents_dao.list_for_scratch(module_id, SCRATCH_TASK_ID)
    await _prune_missing_documents(rows)
    rows = await documents_dao.list_for_scratch(module_id, SCRATCH_TASK_ID)
    return [doc_payload(r) for r in rows]


async def list_task_documents(
    task_id: str,
    *,
    project_id: Optional[str] = None,
    module_id: Optional[str] = None,
    profile: Optional[int] = None,
) -> list[dict]:
    """List a task's design documents, rescanning their directories.

    Re-resolves the canonical design directory (when a module folder is
    configured) so documents that arrived without a watcher — planning
    promotion, backend downtime — are still discovered.
    """

    rows = await documents_dao.list_for_task(task_id)
    run_roots = await runs_dao.list_design_dirs_for_task(task_id)
    roots = {r.root_dir for r in rows} | set(run_roots)

    # Re-resolve the canonical directory from owned worktracker data; failures
    # only cost discovery of unregistered files, never the listing itself.

    resolved_module_id = module_id
    if project_id and module_id:
        try:
            prof = resolve_profile(profile)
            folder = module_link_path(prof, module_id)
            if folder and os.path.isdir(folder):
                modules = await worktracker_queries.get_modules(project_id)
                module = next((m for m in modules if m.id == module_id), None)
                details = await worktracker_queries.get_task_details(project_id, task_id)
                if module is not None:
                    rel = design_docs.resolve_task_design_dir(
                        Path(folder), module, details.task
                    )
                    roots.add(str((Path(folder) / rel).resolve()))
        except Exception:
            pass
    if resolved_module_id is None:
        resolved_module_id = next((r.module_id for r in rows), "")

    known = {(r.root_dir, r.rel_path) for r in rows}
    await _rescan_roots(
        roots, known, module_id=resolved_module_id, task_id=task_id, scope="task"
    )
    rows = await documents_dao.list_for_task(task_id)
    await _prune_missing_documents(rows)
    rows = await documents_dao.list_for_task(task_id)
    return [doc_payload(r) for r in rows]


async def read_document_asset(
    doc_id: str, asset_path: str
) -> Optional[tuple[bytes, str]]:
    """Read a registered document or one of its relative assets.

    Every request is validated against the document's registered
    design-directory boundary: traversal, symlink escapes, unregistered
    documents, missing files, and disallowed types all return ``None`` (the
    caller maps that to a uniform 404).

    :return: ``(content_bytes, media_type)`` on success, else ``None``.
    """

    row = await documents_dao.get_document(doc_id)
    if row is None:
        return None

    resolved = _resolve_document_asset(row, asset_path)
    if resolved is None:
        return None
    target, media_type = resolved
    content = await asyncio.to_thread(target.read_bytes)
    return content, media_type


def _resolve_document_asset(
    row: DesignDocument, asset_path: str
) -> Optional[tuple[Path, str]]:
    """Resolve one allowed asset within a registered document boundary."""

    root = Path(row.root_dir).resolve()
    try:
        target = (root / asset_path).resolve()
        target.relative_to(root)
    except (ValueError, OSError):
        return None
    if not target.is_file():
        return None

    media_type = _ASSET_MEDIA_TYPES.get(target.suffix.lower())
    if media_type is None:
        return None
    return target, media_type


async def save_primary_markdown(
    doc_id: str, content: bytes, expected_digest: str
) -> Optional[SaveDocumentResult]:
    """Atomically replace a registered primary Markdown document.

    The registered ``rel_path`` is the only possible target. Resolution uses
    the same containment, symlink and extension checks as the read path.
    """

    row = await documents_dao.get_document(doc_id)
    if row is None:
        return None

    resolved = _resolve_document_asset(row, row.rel_path)
    if resolved is None:
        return None
    target, media_type = resolved
    if media_type != "text/markdown":
        return None

    return await asyncio.to_thread(
        _digest_guarded_atomic_replace,
        target,
        content,
        expected_digest,
    )


def _digest_guarded_atomic_replace(
    target: Path, content: bytes, expected_digest: str
) -> SaveDocumentResult:
    current_digest = hashlib.sha256(target.read_bytes()).hexdigest()
    normalized_digest = expected_digest
    if (
        len(normalized_digest) >= 2
        and normalized_digest[0] == '"'
        and normalized_digest[-1] == '"'
    ):
        normalized_digest = normalized_digest[1:-1]
    if normalized_digest != current_digest:
        return SaveDocumentResult(status="conflict", digest=current_digest)

    atomic_write_bytes(target, content)

    return SaveDocumentResult(
        status="saved", digest=hashlib.sha256(content).hexdigest()
    )


def complete_directories(path: str = "") -> list[str]:
    """Autocomplete filesystem directories under ``path``.

    Returns absolute directory paths matching the trailing prefix. Hidden
    directories are excluded unless the prefix itself begins with a dot. Any
    error yields an empty list rather than raising.
    """

    try:
        expanded = os.path.expanduser(path) if path else os.path.expanduser("~")
        if path.endswith("/") or path == "":
            base = Path(expanded)
            prefix = ""
        else:
            p = Path(expanded)
            base = p.parent
            prefix = p.name
        if not base.exists() or not base.is_dir():
            return []
        include_hidden = prefix.startswith(".")
        entries = []
        for child in base.iterdir():
            if not child.is_dir():
                continue
            if not include_hidden and child.name.startswith("."):
                continue
            if prefix and not child.name.startswith(prefix):
                continue
            entries.append(str(child.resolve()))
        entries.sort()
        return entries
    except Exception:
        return []
