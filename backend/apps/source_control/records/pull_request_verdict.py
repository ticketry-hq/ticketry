"""Lazy provider verdicts for pull requests recorded by ship actions."""

from __future__ import annotations

import json
from dataclasses import dataclass

from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.source_control.clients.gh_cli import run_gh
from apps.source_control.errors import ProviderTimedOut, ProviderUnavailable
from apps.source_control.models import PR_CLOSED, PR_MERGED, PR_OPEN, ShipRecord

#: Stored states that can never change again, so ``gh`` is asked at most once.
_TERMINAL_STATES = frozenset({PR_MERGED, PR_CLOSED})
#: The ship record stores lowercase states; the generated API contract and the
#: Changes tab read the uppercase wire enum. This module is the only translator.
_WIRE_STATES = {PR_OPEN: "OPEN", PR_MERGED: "MERGED", PR_CLOSED: "CLOSED"}
_PROVIDER_STATES = {"OPEN": PR_OPEN, "MERGED": PR_MERGED, "CLOSED": PR_CLOSED}


@dataclass(frozen=True)
class PullRequestVerdict:
    url: str
    number: int | None
    state: str


def read_pull_request_verdict(
    *, task_id: str, checkout_path: str
) -> PullRequestVerdict | None:
    """Read the latest shipped PR, caching only merged or closed verdicts."""

    record = _latest_pull_request(task_id)
    if record is None:
        return None
    if record.pr_state in _TERMINAL_STATES:
        return _present(record, record.pr_state)

    state = _provider_state(record.pr_url, checkout_path)
    if state is None:
        return None
    if state in _TERMINAL_STATES:
        _persist(record, state)
    return _present(record, state)


def _latest_pull_request(task_id: str) -> ShipRecord | None:
    """The newest PR-bearing ship record anchored to the top-level task."""

    try:
        return (
            ShipRecord.objects.filter(task_id=task_id, pr_url__isnull=False)
            .exclude(pr_url="")
            .order_by("-action_at", "-id")
            .first()
        )
    except (ValidationError, ValueError):
        return None


def _persist(record: ShipRecord, state: str) -> None:
    """Stamp the terminal verdict onto the record's two mutable refresh facts."""

    record.pr_state = state
    record.pr_refreshed_at = timezone.now()
    try:
        record.save(update_fields=("pr_state", "pr_refreshed_at"))
    except ValidationError:
        # A record the ship-record validators reject still has a true verdict;
        # report it and let the next read try the cache write again.
        pass


def _provider_state(url: str, checkout_path: str) -> str | None:
    try:
        completion = run_gh(
            ["pr", "view", url, "--json", "state,mergedAt"],
            cwd=checkout_path,
            operation="the recorded pull request",
        )
    except (ProviderTimedOut, ProviderUnavailable):
        return None
    if completion.exit_code != 0:
        return None
    try:
        payload = json.loads(completion.stdout)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("mergedAt"):
        return PR_MERGED
    return _PROVIDER_STATES.get(str(payload.get("state", "")).upper())


def _present(record: ShipRecord, state: str) -> PullRequestVerdict:
    return PullRequestVerdict(
        url=record.pr_url,
        number=record.pr_number,
        state=_WIRE_STATES[state],
    )
