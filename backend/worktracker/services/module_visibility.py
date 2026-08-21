"""Transactional module-tab visibility persistence."""

from django.db import transaction

from worktracker.models import Issue, ModulePresentation
from worktracker.services.errors import NotFoundError


@transaction.atomic
def set_module_tab_hidden(module_id, *, tab_hidden: bool) -> ModulePresentation:
    """Set visibility without changing the module or its canonical rank."""

    module = (
        Issue.objects.select_for_update()
        .filter(pk=module_id, type="module")
        .first()
    )
    if module is None:
        raise NotFoundError("Module not found.")

    presentation, _ = ModulePresentation.objects.update_or_create(
        module=module,
        defaults={"tab_hidden": tab_hidden},
    )
    return presentation
