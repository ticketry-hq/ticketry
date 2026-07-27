"""C9 — admin smoke: the Issue change-form is reachable for staff."""

import pytest
from django.contrib.auth import get_user_model


@pytest.mark.django_db
def test_issue_changeform_reachable_for_staff(client):
    user_model = get_user_model()
    staff = user_model.objects.create_user(
        username="staff", password="pw", is_staff=True, is_superuser=True
    )
    client.force_login(staff)

    # The Issue changelist is the deep-link target S5 (worktrackerUrl.ts) repoints to.
    r = client.get("/wt-admin/worktracker/issue/")
    assert r.status_code == 200


@pytest.mark.django_db
@pytest.mark.parametrize(
    "path",
    [
        "/wt-admin/runs/agentrun/",
        "/wt-admin/terminals/agentterminalsession/",
        "/wt-admin/documents/designdocument/",
    ],
)
def test_operational_changelists_reachable_for_staff(client, path):
    user_model = get_user_model()
    staff = user_model.objects.create_user(
        username=f"staff-{path}", password="pw", is_staff=True, is_superuser=True
    )
    client.force_login(staff)

    r = client.get(path)
    assert r.status_code == 200


def test_admin_static_assets_are_served(client):
    r = client.get("/static/admin/css/base.css")

    assert r.status_code == 200
    assert r["Content-Type"] == "text/css"
