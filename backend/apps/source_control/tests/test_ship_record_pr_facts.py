from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from apps.source_control.action_checkout import task_checkout_for_action
from apps.source_control.action_steps import STATUS_OK, STEP_PULL_REQUEST, ActionStep
from apps.source_control.models import PR_OPEN
from apps.source_control.ship_records import persist_ship_record
from apps.source_control.tests.conftest import MODULE_ID, TASK_ID

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.mark.parametrize(
    "raw_url",
    (
        "https://github.example.com/ticketry-hq/ticketry/pull/42",
        "https://github.com/ticketry-hq/ticketry/pull/42\n",
        "https://github.com/ticketry-hq/ticketry/pull/0",
    ),
)
def test_unparsed_pull_request_url_is_stored_as_a_descriptive_fact(
    checkout, raw_url
):
    resolved = task_checkout_for_action(TASK_ID, module_id=MODULE_ID)
    outcome = SimpleNamespace(
        branch=resolved.branch,
        commit_shas=(),
        steps=(ActionStep(STEP_PULL_REQUEST, STATUS_OK, "Pull request created."),),
        pull_request_url=raw_url,
    )

    record = persist_ship_record(resolved, outcome, action_id=uuid.uuid4())

    assert record.pr_url == raw_url
    assert record.pr_number is None
    assert record.pr_state == PR_OPEN
