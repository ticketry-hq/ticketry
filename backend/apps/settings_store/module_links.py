"""Transactional Module-link persistence and runtime path resolution."""

from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from worktracker.models import Issue
from worktracker.services.errors import NotFoundError, ValidationError

from apps.settings_store.models import ModuleLink
from apps.settings_store.module_folder_validation import validate_module_folder


def _validated_local_path(local_path: str) -> str:
    candidate = local_path.strip()
    result = validate_module_folder(candidate)
    if not result["valid"]:
        raise ValidationError(result["reason"] or "invalid_module_folder")
    return candidate


def _persist_module_link(module_id, *, local_path: str) -> ModuleLink:
    with transaction.atomic():
        module = (
            Issue.objects.select_for_update()
            .filter(pk=module_id, type="module")
            .first()
        )
        if module is None:
            raise ValidationError(
                "module_id must identify an existing module work item"
            )
        link, _ = ModuleLink.objects.update_or_create(
            module=module,
            defaults={"local_path": local_path},
        )
        return link


def upsert_module_link(module_id, *, local_path: str) -> ModuleLink:
    """Create or replace one module's host link with last-write-wins semantics."""

    return _persist_module_link(
        module_id,
        local_path=_validated_local_path(local_path),
    )


def import_module_link(module_id, *, local_path: str) -> ModuleLink:
    """Persist a legacy link whose folder may currently be offline."""

    return _persist_module_link(module_id, local_path=local_path.strip())


def delete_module_link(module_id) -> None:
    """Delete the link for ``module_id`` transactionally."""

    with transaction.atomic():
        deleted, _ = ModuleLink.objects.filter(module_id=module_id).delete()
        if not deleted:
            raise NotFoundError("Module link not found.")


def resolve_module_path(module_id) -> str | None:
    """Return the typed host-local path for a module, when one exists."""

    if not module_id:
        return None
    try:
        return (
            ModuleLink.objects.filter(module_id=module_id)
            .values_list("local_path", flat=True)
            .first()
        )
    except (DjangoValidationError, TypeError, ValueError):
        return None
