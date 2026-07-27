import json
import uuid

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import override_settings

from worktracker.models import Issue, IssueType, Project, State, Workspace


def _run(token_file, *, admin_enabled=True):
    """Run provision with a token file and return its printed profile dict."""

    from io import StringIO

    out = StringIO()
    with override_settings(
        ADMIN_ENABLED=admin_enabled,
        WORKTRACKER_API_TOKEN="",
        WORKTRACKER_TOKEN_FILE=str(token_file),
    ):
        call_command(
            "provision",
            admin_username="admin" if admin_enabled else None,
            admin_password="admin" if admin_enabled else None,
            stdout=out,
        )

    return json.loads(out.getvalue())


@pytest.mark.django_db
def test_fresh_run_creates_installation_rows_without_domain_data(tmp_path):
    """Fresh provision creates the installation shell, not a domain project."""

    profile = _run(tmp_path / "token")

    assert Workspace.objects.count() == 1
    assert Workspace.objects.get().onboarding_required is True
    assert Project.objects.count() == 0
    assert State.objects.count() == 0
    assert IssueType.objects.count() == 0
    assert Issue.objects.count() == 0
    assert get_user_model().objects.filter(is_superuser=True).count() == 1
    assert profile["project_id"] is None
    assert profile["token"]


@pytest.mark.django_db
def test_second_run_is_noop(tmp_path):
    """Second run leaves row counts unchanged and re-prints a stable token (C8)."""

    token_file = tmp_path / "token"
    first = _run(token_file)
    second = _run(token_file)

    assert Workspace.objects.count() == 1
    assert Project.objects.count() == 0
    assert State.objects.count() == 0
    assert IssueType.objects.count() == 0
    assert Issue.objects.count() == 0
    assert get_user_model().objects.count() == 1
    assert first["project_id"] is None
    assert second["project_id"] is None
    assert first["token"] == second["token"]


@pytest.mark.django_db
def test_admin_disabled_provision_is_idempotent_without_a_superuser(tmp_path):
    token_file = tmp_path / "token"

    first = _run(token_file, admin_enabled=False)
    second = _run(token_file, admin_enabled=False)

    assert Workspace.objects.count() == 1
    assert get_user_model().objects.count() == 0
    assert first == second


@pytest.mark.django_db
def test_admin_disabled_provision_closes_an_upgraded_installs_superuser(tmp_path):
    """Hiding ``wt-admin/`` does not remove a credential an earlier install made.

    Before T1419 the provisioning defaults were literally ``admin``/``admin``,
    so an upgraded install carries a superuser with well-known credentials. No
    admin surface has to mean no admin credential.
    """

    user_model = get_user_model()
    legacy = user_model.objects.create_user(
        username="admin", password="admin", is_staff=True, is_superuser=True
    )

    _run(tmp_path / "token", admin_enabled=False)

    legacy.refresh_from_db()
    assert (legacy.is_staff, legacy.is_superuser, legacy.is_active) == (
        False,
        False,
        False,
    )
    assert not user_model.objects.filter(is_active=True, is_superuser=True).exists()


@pytest.mark.django_db
def test_admin_disabled_provision_leaves_ordinary_accounts_alone(tmp_path):
    user_model = get_user_model()
    member = user_model.objects.create_user(username="member", password="pw")

    _run(tmp_path / "token", admin_enabled=False)

    member.refresh_from_db()
    assert member.is_active is True


@pytest.mark.django_db
def test_rerun_preserves_acknowledged_onboarding(tmp_path):
    token_file = tmp_path / "token"
    _run(token_file)
    workspace = Workspace.objects.get()
    workspace.onboarding_required = False
    workspace.save(update_fields=["onboarding_required"])

    _run(token_file)

    workspace.refresh_from_db()
    assert workspace.onboarding_required is False


@pytest.mark.django_db
def test_rerun_leaves_existing_projects_untouched(tmp_path):
    token_file = tmp_path / "token"
    workspace = Workspace.objects.create(
        id=uuid.uuid4(),
        slug="meml",
        name="Existing workspace",
        onboarding_required=False,
    )
    project = Project.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        name="Existing project",
        slug="KEEP",
        description="Do not modify",
        seq_counter=17,
    )
    before = Project.objects.values().get(pk=project.id)

    profile = _run(token_file)

    assert Project.objects.count() == 1
    assert Project.objects.values().get(pk=project.id) == before
    assert profile["project_id"] is None
