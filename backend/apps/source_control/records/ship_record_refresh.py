"""Manual refresh of the two mutable facts on a PR-bearing ship record."""

from django.db import transaction
from django.utils import timezone

from apps.source_control.models import ShipRecord
from apps.source_control.records.pull_request_state import lookup_pull_request_state


def refresh_ship_record_pr_state(record: ShipRecord) -> ShipRecord:
    """Look up one stored PR, then atomically save only its refresh facts."""

    state = lookup_pull_request_state(record.pr_url)
    with transaction.atomic():
        locked = ShipRecord.objects.select_for_update().get(pk=record.pk)
        locked.pr_state = state
        locked.pr_refreshed_at = timezone.now()
        locked.save(update_fields=("pr_state", "pr_refreshed_at"))
    return locked
