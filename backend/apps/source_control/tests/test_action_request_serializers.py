from __future__ import annotations

import uuid

import pytest

from apps.source_control.rest.serializers.pull_request import (
    ModulePullRequestRequestSerializer,
    WorktreePullRequestRequestSerializer,
)
from apps.source_control.rest.serializers.push import (
    ModuleActionRequestSerializer,
    WorktreeActionRequestSerializer,
)


@pytest.mark.parametrize(
    ("serializer_class", "checkout_fields"),
    (
        (
            WorktreeActionRequestSerializer,
            {"task_id": "task-id", "module_id": "module-id"},
        ),
        (ModuleActionRequestSerializer, {"module_id": "module-id"}),
        (
            WorktreePullRequestRequestSerializer,
            {"task_id": "task-id", "module_id": "module-id"},
        ),
        (ModulePullRequestRequestSerializer, {"module_id": "module-id"}),
    ),
)
def test_action_request_serializer_preserves_optional_action_identifier(
    serializer_class, checkout_fields
):
    action_id = uuid.uuid4()
    serializer = serializer_class(data={**checkout_fields, "action_id": action_id})

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["action_id"] == action_id
