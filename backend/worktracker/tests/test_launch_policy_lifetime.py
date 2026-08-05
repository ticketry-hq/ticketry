"""``subtree_run_enabled`` rides on ``LaunchBinding`` but outlives no policy.

The flag and a launch policy have independent lifetimes, so a row can exist
purely to carry the flag. Every "is a launch configured here" read has to ask
:pyattr:`LaunchBinding.has_launch_policy` rather than whether the row exists —
otherwise switching subtree-run on fabricates a configuration the editor shows,
the launch door refuses with the wrong code, and auto-start stops guarding.

The second half pins the standing warnings that make a Settings-side
deactivation visible before ten launches fail one at a time.
"""

import uuid

import pytest

from apps.settings_store.models import AppSetting
from apps.settings_store.provider_catalog import (
    PROVIDER_CATALOG_KEY,
    PROVIDER_CATALOG_SCOPE,
    ProviderCatalog,
)
from worktracker.models import IssueType, LaunchBinding, State
from worktracker.services import scoped_workflows as svc
from worktracker.services.errors import ValidationError
from worktracker.services.launch_bindings import (
    LaunchBindingError,
    resolve_launch_binding,
)


pytestmark = pytest.mark.django_db


@pytest.fixture
def workflow(project):
    state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Ready", group="unstarted"
    )
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Story",
        level="task",
        start_state=state,
    )
    return issue_type, state


def _revision(issue_type) -> int:
    issue_type.refresh_from_db()
    return issue_type.workflow_revision


LAUNCH_POLICY_CODES = {"provider_not_activated", "auto_start_without_default"}


def _launch_warnings(issue_type) -> list[dict]:
    """Only the launch-policy warnings; graph-shape ones are asserted elsewhere."""

    return [
        warning
        for warning in svc.get_workflow(issue_type.id)["warnings"]
        if warning["code"] in LAUNCH_POLICY_CODES
    ]


def _store_catalog(*, activated_providers=None, global_default=None) -> None:
    if activated_providers is not None:
        from worktracker.models import Provider

        Provider.objects.update(activated=False)
        Provider.objects.filter(slug__in=activated_providers).update(activated=True)
    AppSetting.objects.update_or_create(
        scope=PROVIDER_CATALOG_SCOPE,
        key=PROVIDER_CATALOG_KEY,
        defaults={
            "value": ProviderCatalog(global_default=global_default).model_dump_json(),
            "updated_at": "2026-07-27T00:00:00+00:00",
        },
    )


def test_disabling_subtree_run_removes_a_row_that_carries_no_policy(workflow):
    issue_type, state = workflow

    svc.set_subtree_run(
        issue_type.id, state.id, enabled=True, workflow_revision=_revision(issue_type)
    )
    assert LaunchBinding.objects.filter(issue_type=issue_type, state=state).exists()

    svc.set_subtree_run(
        issue_type.id, state.id, enabled=False, workflow_revision=_revision(issue_type)
    )

    assert not LaunchBinding.objects.filter(issue_type=issue_type, state=state).exists()


def test_disabling_subtree_run_keeps_a_row_that_carries_policy(workflow):
    issue_type, state = workflow
    svc.upsert_launch_binding(
        issue_type.id,
        state.id,
        prompt="do the thing",
        agent="claude",
        model=None,
        reasoning=None,
        workflow_revision=_revision(issue_type),
    )
    svc.set_subtree_run(
        issue_type.id, state.id, enabled=True, workflow_revision=_revision(issue_type)
    )

    svc.set_subtree_run(
        issue_type.id, state.id, enabled=False, workflow_revision=_revision(issue_type)
    )

    binding = LaunchBinding.objects.get(issue_type=issue_type, state=state)
    assert binding.subtree_run_enabled is False
    assert binding.prompt == "do the thing"


def test_auto_start_still_requires_a_launch_binding_behind_the_flag(workflow):
    """The ``DoesNotExist`` guard used to be satisfied by the empty row."""

    issue_type, state = workflow
    svc.set_subtree_run(
        issue_type.id, state.id, enabled=True, workflow_revision=_revision(issue_type)
    )

    with pytest.raises(ValidationError, match="Configure a launch binding"):
        svc.set_auto_start(
            issue_type.id,
            state.id,
            auto_start=False,
            workflow_revision=_revision(issue_type),
        )


def test_a_flag_only_row_refuses_a_launch_as_unconfigured(workflow):
    """Same user-visible situation as an absent row, so the same code."""

    issue_type, state = workflow
    svc.set_subtree_run(
        issue_type.id, state.id, enabled=True, workflow_revision=_revision(issue_type)
    )

    with pytest.raises(LaunchBindingError) as raised:
        resolve_launch_binding(issue_type.id, state.id)

    assert raised.value.code == "binding_not_configured"


def test_a_deactivated_provider_raises_a_standing_warning(workflow):
    issue_type, state = workflow
    svc.upsert_launch_binding(
        issue_type.id,
        state.id,
        prompt="do the thing",
        agent="codex",
        model=None,
        reasoning=None,
        workflow_revision=_revision(issue_type),
    )
    _store_catalog(activated_providers=frozenset({"claude", "gemini"}))

    warnings = _launch_warnings(issue_type)

    assert [warning["code"] for warning in warnings] == ["provider_not_activated"]
    assert warnings[0]["state_id"] == state.id
    assert "codex" in warnings[0]["message"]


def test_auto_start_leaning_on_an_absent_default_raises_a_standing_warning(workflow):
    issue_type, state = workflow
    _store_catalog(
        activated_providers=frozenset({"claude", "codex", "gemini"}),
        global_default={"provider": "claude"},
    )
    svc.upsert_launch_binding(
        issue_type.id,
        state.id,
        prompt="do the thing",
        agent=None,
        model=None,
        reasoning=None,
        workflow_revision=_revision(issue_type),
    )
    svc.set_auto_start(
        issue_type.id,
        state.id,
        auto_start=True,
        workflow_revision=_revision(issue_type),
    )

    _store_catalog(activated_providers=frozenset({"claude", "codex", "gemini"}))

    assert [warning["code"] for warning in _launch_warnings(issue_type)] == [
        "auto_start_without_default"
    ]


def test_a_flag_only_row_raises_no_launch_policy_warning(workflow):
    issue_type, state = workflow
    svc.set_subtree_run(
        issue_type.id, state.id, enabled=True, workflow_revision=_revision(issue_type)
    )
    _store_catalog(activated_providers=frozenset())

    assert _launch_warnings(issue_type) == []
