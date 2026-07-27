"""#629 — Blocked default state + protected (non-deletable) states.

Exercises the DELETE guard, the read-only nature of the flag, and the
StateOut serialization through the package's ninja self-test host.
"""

import uuid

import pytest

from worktracker.models import DEFAULT_STATES, IssueType, State
from worktracker.seed import (
    ensure_issue_types,
    ensure_protected_states,
    ensure_state_order,
)
from worktracker.tests.conftest import BASE, patch_json, post_json


def _seed(project):
    """Seed a project the way provision / the migration do (states + flags)."""
    for name, group, color in DEFAULT_STATES:
        State.objects.get_or_create(
            project=project,
            name=name,
            defaults={"id": uuid.uuid4(), "group": group, "color": color},
        )
    ensure_state_order(project, State)
    ensure_issue_types(project, IssueType)
    ensure_protected_states(project, State)


def _states(client, project, auth):
    return client.get(f"{BASE}/projects/{project.id}/states", headers=auth).json()


# --- DELETE guard -----------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("name", ["Done", "Implement", "Refinement"])
def test_delete_protected_state_409(client, project, auth, name):
    """A protected state 409s even when its group has ≥2 states and it's unused."""
    _seed(project)
    # Add a sibling so the last-in-group guard would otherwise pass.
    post_json(
        client,
        f"{BASE}/projects/{project.id}/states",
        {"name": f"{name} Sibling", "group": State.objects.get(
            project=project, name=name
        ).group},
        auth,
    )
    target = State.objects.get(project=project, name=name)

    r = client.delete(f"{BASE}/states/{target.id}", headers=auth)
    assert r.status_code == 409
    assert "protected" in r.json()["detail"].lower()
    assert State.objects.filter(pk=target.id).exists()


@pytest.mark.django_db
def test_delete_unprotected_custom_state_ok_once_group_has_sibling(
    client, project, auth
):
    """A user-created (non-canonical) state is unprotected and deletes normally.

    Every canonical state is protected (CODIN-859), so deletability is exercised
    on a custom state instead.
    """
    _seed(project)
    # A custom state in the started group (which already has Implement + Review),
    # so the last-in-group guard doesn't trip.
    created = post_json(
        client,
        f"{BASE}/projects/{project.id}/states",
        {"name": "Custom", "group": "started"},
        auth,
    ).json()
    assert created["is_protected"] is False

    r = client.delete(f"{BASE}/states/{created['id']}", headers=auth)
    assert r.status_code == 204
    assert not State.objects.filter(pk=created["id"]).exists()


# --- read-only flag ---------------------------------------------------------


@pytest.mark.django_db
def test_create_state_never_protected_and_is_deletable(client, project, auth):
    _seed(project)
    created = post_json(
        client,
        f"{BASE}/projects/{project.id}/states",
        {"name": "In Review", "group": "started", "is_protected": True},
        auth,
    ).json()

    assert created["is_protected"] is False
    assert State.objects.get(pk=created["id"]).is_protected is False
    # And it can be deleted (started group already has In Progress).
    r = client.delete(f"{BASE}/states/{created['id']}", headers=auth)
    assert r.status_code == 204


@pytest.mark.django_db
def test_patch_cannot_set_flag_but_rename_recolor_regroup_persist(
    client, project, auth
):
    _seed(project)
    done = State.objects.get(project=project, name="Done")

    r = patch_json(
        client,
        f"{BASE}/states/{done.id}",
        {"name": "Shipped", "color": "#22c55e", "group": "started",
         "is_protected": False},
        auth,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Shipped"
    assert body["color"] == "#22c55e"
    assert body["group"] == "started"
    # Protection survives a rename / recolor / group-move.
    assert body["is_protected"] is True
    assert State.objects.get(pk=done.id).is_protected is True


# --- serialization ----------------------------------------------------------


@pytest.mark.django_db
def test_state_out_serializes_is_protected(client, project, auth):
    _seed(project)
    states = _states(client, project, auth)
    assert all("is_protected" in s for s in states)
    protected = {s["name"] for s in states if s["is_protected"]}
    assert protected == {
        "Idea",
        "Refinement",
        "Ready",
        "Implement",
        "Review",
        "Done",
        "Cancelled",
    }
