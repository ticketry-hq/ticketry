"""S6 — configurable issue types (G1) + workflow-state CRUD (G2).

Exercises all 9 new routes plus their guards and invariants through the
package's ninja self-test host, and confirms the seed / backfill behavior.
"""

import uuid

import pytest

from worktracker.models import (
    DEFAULT_STATES,
    Issue,
    IssueType,
    State,
)
from worktracker.seed import ensure_issue_types, ensure_state_order
from worktracker.tests.conftest import BASE, patch_json, post_json


CARBON_DARK_PALETTE = {
    "#8A3FFC",
    "#33B1FF",
    "#007D79",
    "#FF7EB6",
    "#FA4D56",
    "#FFF1F1",
    "#6FDC8C",
    "#4589FF",
    "#D12771",
    "#D2A106",
    "#08BDBA",
    "#BAE6FF",
    "#BA4E00",
    "#D4BBFF",
}


# --- helpers ----------------------------------------------------------------


def _seed(project):
    """Seed a project the way provision / the migration do (types + state order)."""
    for order, (name, group, color) in enumerate(DEFAULT_STATES):
        State.objects.get_or_create(
            project=project,
            name=name,
            defaults={"id": uuid.uuid4(), "group": group, "color": color},
        )
    ensure_state_order(project, State)
    ensure_issue_types(project, IssueType)


def _types(client, project, auth):
    return client.get(
        f"{BASE}/projects/{project.id}/issue-types", headers=auth
    ).json()


def _states(client, project, auth):
    return client.get(f"{BASE}/projects/{project.id}/states", headers=auth).json()


def _make_task(client, project, auth, **body):
    body.setdefault("name", "T")
    r = post_json(client, f"{BASE}/projects/{project.id}/work-items", body, auth)
    assert r.status_code == 200, r.content
    return r.json()


# --- seed -------------------------------------------------------------------


@pytest.mark.django_db
def test_seed_creates_defaults(client, project, auth):
    _seed(project)
    types = _types(client, project, auth)
    by_name = {t["name"]: t for t in types}
    assert by_name["Module"]["level"] == "module" and by_name["Module"]["is_default"]
    assert by_name["Story"]["level"] == "task" and by_name["Story"]["is_default"]
    # PathFind and Implementation are task-level but never the default.
    assert by_name["PathFind"]["level"] == "task" and not by_name["PathFind"]["is_default"]
    assert (
        by_name["Implementation"]["level"] == "task"
        and not by_name["Implementation"]["is_default"]
    )

    states = _states(client, project, auth)
    assert [s["sort_order"] for s in states] == sorted(s["sort_order"] for s in states)
    assert [s["sort_order"] for s in states] == list(range(len(states)))


@pytest.mark.django_db
def test_seed_is_idempotent(project):
    _seed(project)
    _seed(project)
    assert IssueType.objects.filter(project=project).count() == 4
    assert (
        IssueType.objects.filter(project=project, level="module", is_default=True).count()
        == 1
    )


# --- create type ------------------------------------------------------------


@pytest.mark.django_db
def test_create_type_appends_non_default(client, project, auth):
    _seed(project)
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/issue-types",
        {"name": "Bug", "level": "task", "color": "#ef4444"},
        auth,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["is_default"] is False
    # Task-level seeds are Story(1), PathFind(2), Implementation(3), so the new
    # task type lands at 4.
    assert body["sort_order"] == 4


@pytest.mark.django_db
def test_create_type_duplicate_name_409(client, project, auth):
    _seed(project)
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/issue-types",
        {"name": "Module", "level": "module"},
        auth,
    )
    assert r.status_code == 409


@pytest.mark.django_db
def test_create_type_bad_level_422(client, project, auth):
    _seed(project)
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/issue-types",
        {"name": "Saga", "level": "portfolio"},
        auth,
    )
    assert r.status_code == 422


# --- set default flips ------------------------------------------------------


@pytest.mark.django_db
def test_set_default_flips_prior(client, project, auth):
    _seed(project)
    spike = post_json(
        client,
        f"{BASE}/projects/{project.id}/issue-types",
        {"name": "Spike", "level": "task"},
        auth,
    ).json()

    r = patch_json(
        client, f"{BASE}/issue-types/{spike['id']}", {"is_default": True}, auth
    )
    assert r.status_code == 200
    assert r.json()["is_default"] is True

    defaults = IssueType.objects.filter(
        project=project, level="task", is_default=True
    )
    assert defaults.count() == 1
    assert str(defaults.first().id) == spike["id"]


@pytest.mark.django_db
def test_clearing_default_directly_409(client, project, auth):
    _seed(project)
    module_type = IssueType.objects.get(project=project, name="Module")
    r = patch_json(client, f"{BASE}/issue-types/{module_type.id}", {"is_default": False}, auth)
    assert r.status_code == 409


# --- derive on create -------------------------------------------------------


@pytest.mark.django_db
def test_create_with_type_sets_binary(client, project, auth):
    _seed(project)
    story = IssueType.objects.get(project=project, name="Story", level="task")

    task = _make_task(client, project, auth, issue_type_id=str(story.id))
    assert task["issue_type"]["name"] == "Story"
    assert Issue.objects.get(pk=task["id"]).type == "task"


@pytest.mark.django_db
def test_create_without_type_uses_bucket_default(client, project, auth):
    _seed(project)
    task = _make_task(client, project, auth)
    assert task["issue_type"]["name"] == "Story"


@pytest.mark.django_db
def test_create_with_wrong_level_type_422(client, project, auth):
    _seed(project)
    module_type = IssueType.objects.get(project=project, name="Module")
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "T", "issue_type_id": str(module_type.id)},
        auth,
    )
    assert r.status_code == 422


# --- delete type guards -----------------------------------------------------


@pytest.mark.django_db
def test_delete_default_type_409(client, project, auth):
    _seed(project)
    module_type = IssueType.objects.get(project=project, name="Module")
    r = client.delete(f"{BASE}/issue-types/{module_type.id}", headers=auth)
    assert r.status_code == 409


@pytest.mark.django_db
def test_delete_type_in_use_409_then_reassign(client, project, auth):
    _seed(project)
    bug = post_json(
        client,
        f"{BASE}/projects/{project.id}/issue-types",
        {"name": "Bug", "level": "task"},
        auth,
    ).json()
    task = _make_task(client, project, auth, issue_type_id=bug["id"])

    blocked = client.delete(f"{BASE}/issue-types/{bug['id']}", headers=auth)
    assert blocked.status_code == 409

    default_task = IssueType.objects.get(project=project, name="Story")
    ok = client.delete(
        f"{BASE}/issue-types/{bug['id']}?reassign_to={default_task.id}", headers=auth
    )
    assert ok.status_code == 204
    assert Issue.objects.get(pk=task["id"]).issue_type_id == default_task.id


@pytest.mark.django_db
def test_reorder_types(client, project, auth):
    _seed(project)
    bug = post_json(
        client,
        f"{BASE}/projects/{project.id}/issue-types",
        {"name": "Bug", "level": "task"},
        auth,
    ).json()
    ids = [t["id"] for t in _types(client, project, auth)]
    reversed_ids = list(reversed(ids))

    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/issue-types/reorder",
        {"ordered_ids": reversed_ids},
        auth,
    )
    assert r.status_code == 200
    assert [t["id"] for t in r.json()] == reversed_ids
    assert bug["id"] in ids


@pytest.mark.django_db
def test_reorder_types_unknown_id_422(client, project, auth):
    _seed(project)
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/issue-types/reorder",
        {"ordered_ids": [str(uuid.uuid4())]},
        auth,
    )
    assert r.status_code == 422


# --- states CRUD ------------------------------------------------------------


@pytest.mark.django_db
def test_create_state_appends(client, project, auth):
    _seed(project)
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/states",
        {"name": "In Review", "group": "started", "color": "#f59e0b"},
        auth,
    )
    assert r.status_code == 200
    names = [s["name"] for s in _states(client, project, auth)]
    assert "In Review" in names


@pytest.mark.django_db
@pytest.mark.parametrize("body_color", [None, ""])
def test_create_state_without_color_returns_persisted_palette_color(
    client, project, auth, body_color
):
    body = {"name": "In Review", "group": "started"}
    if body_color is not None:
        body["color"] = body_color

    r = post_json(client, f"{BASE}/projects/{project.id}/states", body, auth)

    assert r.status_code == 200
    assert r.json()["color"] in CARBON_DARK_PALETTE
    assert State.objects.get(pk=r.json()["id"]).color == r.json()["color"]


@pytest.mark.django_db
def test_create_state_preserves_explicit_color(client, project, auth):
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/states",
        {"name": "In Review", "group": "started", "color": "#aBc123"},
        auth,
    )

    assert r.status_code == 200
    assert r.json()["color"] == "#aBc123"


@pytest.mark.django_db
def test_create_state_without_color_returns_conflict_when_palette_exhausted(
    client, project, auth
):
    for index, color in enumerate(CARBON_DARK_PALETTE):
        State.objects.create(
            id=uuid.uuid4(),
            project=project,
            name=f"Existing {index}",
            group="backlog",
            color=color,
        )

    before = State.objects.filter(project=project).count()
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/states",
        {"name": "Overflow", "group": "started", "color": ""},
        auth,
    )

    assert r.status_code == 409
    assert "No automatic workflow-state colors remain" in r.json()["detail"]
    assert State.objects.filter(project=project).count() == before


@pytest.mark.django_db
def test_create_state_bad_group_422(client, project, auth):
    _seed(project)
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/states",
        {"name": "Weird", "group": "sixth"},
        auth,
    )
    assert r.status_code == 422


@pytest.mark.django_db
def test_patch_state_rename_recolor_regroup(client, project, auth):
    _seed(project)
    todo = State.objects.get(project=project, name="Refinement")
    r = patch_json(
        client,
        f"{BASE}/states/{todo.id}",
        {"name": "Up Next", "color": "#60a5fa", "group": "backlog"},
        auth,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Up Next"
    assert body["color"] == "#60a5fa"
    assert body["group"] == "backlog"


@pytest.mark.django_db
def test_patch_state_bad_group_422(client, project, auth):
    _seed(project)
    todo = State.objects.get(project=project, name="Refinement")
    r = patch_json(client, f"{BASE}/states/{todo.id}", {"group": "nope"}, auth)
    assert r.status_code == 422


@pytest.mark.django_db
def test_delete_last_state_in_group_409(client, project, auth):
    _seed(project)
    backlog = State.objects.get(project=project, group="backlog")
    r = client.delete(f"{BASE}/states/{backlog.id}", headers=auth)
    assert r.status_code == 409


@pytest.mark.django_db
def test_delete_state_in_use_409_then_reassign(client, project, auth):
    _seed(project)
    # A custom, deletable state (canonical states are all protected) plus a
    # sibling reassign target — both in the started group so neither is the
    # last-in-group.
    doomed = post_json(
        client,
        f"{BASE}/projects/{project.id}/states",
        {"name": "Doomed", "group": "started"},
        auth,
    ).json()
    extra = post_json(
        client,
        f"{BASE}/projects/{project.id}/states",
        {"name": "In Review", "group": "started"},
        auth,
    ).json()
    # An ungated custom type: the seeded default (Story) is birth-gated (#870)
    # and could not be created directly in a custom state.
    chore = post_json(
        client,
        f"{BASE}/projects/{project.id}/issue-types",
        {"name": "Chore", "level": "task"},
        auth,
    ).json()
    task = _make_task(
        client, project, auth, state_id=doomed["id"], issue_type_id=chore["id"]
    )

    blocked = client.delete(f"{BASE}/states/{doomed['id']}", headers=auth)
    assert blocked.status_code == 409

    impact = client.get(
        f"{BASE}/states/{doomed['id']}/impact", headers=auth
    ).json()
    ok = client.delete(
        f"{BASE}/states/{doomed['id']}?reassign_to={extra['id']}"
        f"&impact_token={impact['impact_token']}",
        headers=auth,
    )
    assert ok.status_code == 204
    assert str(Issue.objects.get(pk=task["id"]).state_id) == extra["id"]


@pytest.mark.django_db
def test_reorder_states(client, project, auth):
    _seed(project)
    ids = [s["id"] for s in _states(client, project, auth)]
    reversed_ids = list(reversed(ids))
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/states/reorder",
        {"ordered_ids": reversed_ids},
        auth,
    )
    assert r.status_code == 200
    assert [s["id"] for s in r.json()] == reversed_ids


@pytest.mark.django_db
def test_reorder_states_incomplete_set_422(client, project, auth):
    _seed(project)
    ids = [s["id"] for s in _states(client, project, auth)]
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/states/reorder",
        {"ordered_ids": ids[:-1]},  # missing one
        auth,
    )
    assert r.status_code == 422


# --- additive read changes (existing shapes intact) -------------------------


@pytest.mark.django_db
def test_workitem_out_carries_nullable_issue_type(client, project, auth):
    _seed(project)
    task = _make_task(client, project, auth)
    # Present and nested (default), never a bare id.
    assert task["issue_type"]["level"] == "task"

    # An issue created before seeding (no type) still serializes as null.
    Issue.objects.filter(pk=task["id"]).update(issue_type=None)
    r = client.get(f"{BASE}/work-items/{task['id']}", headers=auth)
    assert r.json()["task"]["issue_type"] is None


@pytest.mark.django_db
def test_router_carries_api_key_auth():
    from worktracker.api import router
    from worktracker.auth import ApiKeyAuth

    assert isinstance(router.auth, ApiKeyAuth)
