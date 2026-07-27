"""C9 — admin smoke: the Issue change-form is reachable for staff.

``ADMIN_ENABLED`` fails closed (T1419 / ADR-0013) and ``studio_server.urls``
decides whether ``wt-admin/`` exists when that module is imported, so flipping
the setting inside a test comes too late. These tests instead run against a
URLconf that mounts the admin explicitly — the same opt-in a development
entrypoint makes — and assert what the mounted surface does, not whether it is
mounted. ``test_admin_surface_is_absent_by_default`` covers the other half.
"""

import pytest
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.urls import path

import studio_server.urls as studio_urls


urlpatterns = [path("wt-admin/", admin.site.urls), *studio_urls.urlpatterns]

pytestmark = pytest.mark.urls(__name__)


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


@pytest.mark.urls("studio_server.urls")
@pytest.mark.django_db
def test_admin_surface_is_absent_by_default(client):
    """No entrypoint opted in, so the real URLconf has no admin to reach."""

    user_model = get_user_model()
    staff = user_model.objects.create_user(
        username="staff-default", password="pw", is_staff=True, is_superuser=True
    )
    client.force_login(staff)

    assert client.get("/wt-admin/worktracker/issue/").status_code == 404
