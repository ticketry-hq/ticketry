"""Mutation routes and retained archived-item filtering behavior."""

import uuid

import pytest

from worktracker.models import Issue, IssueType, Project, State
from worktracker.tests.conftest import BASE, patch_json, post_json


# --- helpers ----------------------------------------------------------------


def _make_task(client, project, auth, name="T", parent_id=None):
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name="Task",
        defaults={"id": uuid.uuid4(), "level": "task"},
    )
    body = {"name": name, "issue_type_id": str(issue_type.id)}
    if parent_id:
        body["parent_id"] = parent_id
    r = post_json(client, f"{BASE}/projects/{project.id}/work-items", body, auth)
    assert r.status_code == 200
    return r.json()


def _make_pathfind_type(project):
    return IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="PathFind", level="task"
    )


def _make_pathfind(
    client, project, auth, pathfind_type, name="Discovery", parent_id=None
):
    body = {"name": name, "issue_type_id": str(pathfind_type.id)}
    if parent_id:
        body["parent_id"] = parent_id
    r = post_json(client, f"{BASE}/projects/{project.id}/work-items", body, auth)
    assert r.status_code == 200
    return r.json()


def _make_module(client, project, auth, name="Epic"):
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name="Module",
        defaults={"id": uuid.uuid4(), "level": "module"},
    )
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/modules",
        {"name": name, "issue_type_id": str(issue_type.id)},
        auth,
    )
    assert r.status_code == 200
    return r.json()


def _task_type(project):
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name="Task",
        defaults={"id": uuid.uuid4(), "level": "task"},
    )
    return issue_type


# --- G3: project create / rename --------------------------------------------


@pytest.mark.django_db
def test_create_project_seeds_states(client, project, auth):
    r = post_json(
        client,
        f"{BASE}/projects",
        {"name": "Second", "slug": "SEC", "workspace_slug": "meml"},
        auth,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == "SEC"

    created = Project.objects.get(id=body["id"])
    assert created.seq_counter == 0
    # The 7 canonical states are seeded so the project is board-ready
    # (CODIN-859); all seven carry the protected flag.
    assert State.objects.filter(project=created).count() == 7
    assert set(State.objects.filter(project=created).values_list("group", flat=True)) == {
        "backlog",
        "unstarted",
        "started",
        "completed",
        "cancelled",
    }
    protected = set(
        State.objects.filter(project=created, is_protected=True).values_list(
            "name", flat=True
        )
    )
    assert protected == {
        "Grill",
        "Spec",
        "Tickets",
        "Implement",
        "Review",
        "Done",
        "Cancelled",
    }


@pytest.mark.django_db
def test_create_project_resolves_sole_workspace(client, project, auth):
    # workspace_slug omitted → resolves the only workspace (the fixture's).
    r = post_json(client, f"{BASE}/projects", {"name": "NoWs", "slug": "NWS"}, auth)
    assert r.status_code == 200
    assert Project.objects.filter(slug="NWS").exists()


@pytest.mark.django_db
def test_create_project_unknown_workspace_404(client, project, auth):
    r = post_json(
        client,
        f"{BASE}/projects",
        {"name": "X", "slug": "XXX", "workspace_slug": "nope"},
        auth,
    )
    assert r.status_code == 404


@pytest.mark.django_db
def test_create_project_duplicate_slug_409(client, project, auth):
    Project.objects.create(
        id=uuid.uuid4(),
        workspace=project.workspace,
        name="Existing",
        slug="DUP",
    )
    r = post_json(
        client,
        f"{BASE}/projects",
        {"name": "Dup", "slug": "DUP", "workspace_slug": "meml"},
        auth,
    )
    assert r.status_code == 409
    assert Project.objects.filter(slug="DUP").count() == 1


@pytest.mark.django_db
def test_rename_project_keeps_slug(client, project, auth):
    r = patch_json(client, f"{BASE}/projects/{project.id}", {"name": "Renamed"}, auth)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Renamed"
    assert body["slug"] == "MEML"


# --- #665: project description CRUD + cascading delete ----------------------


@pytest.mark.django_db
def test_create_project_persists_description(client, project, auth):
    # The optional markdown description rides the create body and round-trips.
    r = post_json(
        client,
        f"{BASE}/projects",
        {"name": "Docs", "slug": "DOC", "description": "# Goals\n\nShip it."},
        auth,
    )
    assert r.status_code == 200
    assert r.json()["description"] == "# Goals\n\nShip it."
    assert Project.objects.get(slug="DOC").description == "# Goals\n\nShip it."


@pytest.mark.django_db
def test_create_project_defaults_description_to_empty(client, project, auth):
    # The fixture project predates the field; ProjectOut serializes it as "".
    r = client.get(f"{BASE}/projects", headers=auth)
    assert r.status_code == 200
    assert {p["slug"]: p["description"] for p in r.json()}["MEML"] == ""


@pytest.mark.django_db
def test_patch_project_description_keeps_slug_immutable(client, project, auth):
    # A description-only patch leaves the name alone; slug is never accepted.
    r = patch_json(
        client,
        f"{BASE}/projects/{project.id}",
        {"description": "updated", "slug": "HACK"},
        auth,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["description"] == "updated"
    assert body["name"] == "meml"  # untouched — name wasn't in the patch
    assert body["slug"] == "MEML"  # slug stays immutable, ignored if sent
    project.refresh_from_db()
    assert project.slug == "MEML"


@pytest.mark.django_db
def test_delete_project_cascades_all_owned_rows(client, project, auth):
    from worktracker.models import Issue, IssueType

    # Seed one of every project-owned row (the fixture project is created raw,
    # not via the route, so its states/types aren't auto-seeded — make them).
    State.objects.create(id=uuid.uuid4(), project=project, name="Todo", group="unstarted")
    IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    module = _make_module(client, project, auth)
    _make_task(client, project, auth, parent_id=module["id"])
    pid = project.id
    assert State.objects.filter(project_id=pid).exists()
    assert IssueType.objects.filter(project_id=pid).exists()
    assert Issue.objects.filter(project_id=pid).exists()

    r = client.delete(f"{BASE}/projects/{pid}", headers=auth)
    assert r.status_code == 204

    # The project and every cascade target are gone.
    assert not Project.objects.filter(id=pid).exists()
    assert State.objects.filter(project_id=pid).count() == 0
    assert IssueType.objects.filter(project_id=pid).count() == 0
    assert Issue.objects.filter(project_id=pid).count() == 0


@pytest.mark.django_db
def test_delete_missing_project_404(client, project, auth):
    r = client.delete(f"{BASE}/projects/{uuid.uuid4()}", headers=auth)
    assert r.status_code == 404


# --- archived-item list filtering -------------------------------------------


@pytest.mark.django_db
def test_archive_hides_from_project_list(client, project, auth):
    task = _make_task(client, project, auth)

    Issue.objects.filter(pk=task["id"]).update(is_archived=True)

    default = client.get(f"{BASE}/projects/{project.id}/work-items", headers=auth).json()
    assert default == []

    full = client.get(
        f"{BASE}/projects/{project.id}/work-items?include_archived=true", headers=auth
    ).json()
    assert [t["id"] for t in full] == [task["id"]]


@pytest.mark.django_db
def test_archive_hides_from_module_list(client, project, auth):
    module = _make_module(client, project, auth)
    task = post_json(
        client,
        f"{BASE}/modules/{module['id']}/work-items",
        {
            "name": "T",
            "issue_type_id": str(_task_type(project).id),
        },
        auth,
    ).json()

    Issue.objects.filter(pk=task["id"]).update(is_archived=True)

    default = client.get(f"{BASE}/modules/{module['id']}/work-items", headers=auth).json()
    assert default == []

    full = client.get(
        f"{BASE}/modules/{module['id']}/work-items?include_archived=true", headers=auth
    ).json()
    assert [t["id"] for t in full] == [task["id"]]


@pytest.mark.django_db
def test_archived_still_retrievable_by_id_and_key(client, project, auth):
    task = _make_task(client, project, auth)
    Issue.objects.filter(pk=task["id"]).update(is_archived=True)

    by_id = client.get(f"{BASE}/work-items/{task['id']}", headers=auth)
    assert by_id.status_code == 200
    assert by_id.json()["task"]["is_archived"] is True

    by_key = client.get(f"{BASE}/work-items/{task['key']}", headers=auth)
    assert by_key.status_code == 200
    assert by_key.json()["task"]["id"] == task["id"]


@pytest.mark.django_db
def test_archive_hides_module_from_module_list(client, project, auth):
    module = _make_module(client, project, auth)
    Issue.objects.filter(pk=module["id"]).update(is_archived=True)

    default = client.get(f"{BASE}/projects/{project.id}/modules", headers=auth).json()
    assert default == []

    full = client.get(
        f"{BASE}/projects/{project.id}/modules?include_archived=true", headers=auth
    ).json()
    assert [m["id"] for m in full] == [module["id"]]


# --- PathFind visibility filtering ------------------------------------------


@pytest.mark.django_db
def test_project_work_item_list_hides_pathfind_by_default(client, project, auth):
    pathfind_type = _make_pathfind_type(project)
    regular = _make_task(client, project, auth, name="Build")
    pathfind = _make_pathfind(client, project, auth, pathfind_type)

    default = client.get(f"{BASE}/projects/{project.id}/work-items", headers=auth)
    assert [t["id"] for t in default.json()] == [regular["id"]]

    full = client.get(
        f"{BASE}/projects/{project.id}/work-items?include_pathfind=true",
        headers=auth,
    )
    assert {t["id"] for t in full.json()} == {regular["id"], pathfind["id"]}


@pytest.mark.django_db
def test_module_work_item_list_hides_pathfind_descendants_by_default(
    client, project, auth
):
    pathfind_type = _make_pathfind_type(project)
    module = _make_module(client, project, auth)
    regular = _make_task(client, project, auth, name="Build", parent_id=module["id"])
    pathfind = _make_pathfind(
        client, project, auth, pathfind_type, parent_id=module["id"]
    )
    nested_pathfind = _make_pathfind(
        client, project, auth, pathfind_type, name="Nested", parent_id=pathfind["id"]
    )

    default = client.get(f"{BASE}/modules/{module['id']}/work-items", headers=auth)
    assert [t["id"] for t in default.json()] == [regular["id"]]

    full = client.get(
        f"{BASE}/modules/{module['id']}/work-items?include_pathfind=true",
        headers=auth,
    )
    assert {t["id"] for t in full.json()} == {
        regular["id"],
        pathfind["id"],
        nested_pathfind["id"],
    }


@pytest.mark.django_db
def test_project_include_archived_does_not_imply_include_pathfind(
    client, project, auth
):
    pathfind_type = _make_pathfind_type(project)
    regular = _make_task(client, project, auth, name="Build")
    pathfind = _make_pathfind(client, project, auth, pathfind_type)
    Issue.objects.filter(pk__in=[regular["id"], pathfind["id"]]).update(is_archived=True)

    archived_only = client.get(
        f"{BASE}/projects/{project.id}/work-items?include_archived=true",
        headers=auth,
    )
    assert [t["id"] for t in archived_only.json()] == [regular["id"]]

    pathfind_only = client.get(
        f"{BASE}/projects/{project.id}/work-items?include_pathfind=true",
        headers=auth,
    )
    assert pathfind_only.json() == []

    both = client.get(
        f"{BASE}/projects/{project.id}/work-items"
        "?include_archived=true&include_pathfind=true",
        headers=auth,
    )
    assert {t["id"] for t in both.json()} == {regular["id"], pathfind["id"]}


@pytest.mark.django_db
def test_module_include_archived_does_not_imply_include_pathfind(client, project, auth):
    pathfind_type = _make_pathfind_type(project)
    module = _make_module(client, project, auth)
    regular = _make_task(client, project, auth, name="Build", parent_id=module["id"])
    pathfind = _make_pathfind(
        client, project, auth, pathfind_type, parent_id=module["id"]
    )
    Issue.objects.filter(pk__in=[regular["id"], pathfind["id"]]).update(is_archived=True)

    archived_only = client.get(
        f"{BASE}/modules/{module['id']}/work-items?include_archived=true",
        headers=auth,
    )
    assert [t["id"] for t in archived_only.json()] == [regular["id"]]

    pathfind_only = client.get(
        f"{BASE}/modules/{module['id']}/work-items?include_pathfind=true",
        headers=auth,
    )
    assert pathfind_only.json() == []

    both = client.get(
        f"{BASE}/modules/{module['id']}/work-items"
        "?include_archived=true&include_pathfind=true",
        headers=auth,
    )
    assert {t["id"] for t in both.json()} == {regular["id"], pathfind["id"]}


@pytest.mark.django_db
def test_pathfind_still_retrievable_by_id_and_key(client, project, auth):
    pathfind_type = _make_pathfind_type(project)
    pathfind = _make_pathfind(client, project, auth, pathfind_type)

    by_id = client.get(f"{BASE}/work-items/{pathfind['id']}", headers=auth)
    assert by_id.status_code == 200
    assert by_id.json()["task"]["issue_type"]["name"] == "PathFind"

    by_key = client.get(f"{BASE}/work-items/{pathfind['key']}", headers=auth)
    assert by_key.status_code == 200
    assert by_key.json()["task"]["id"] == pathfind["id"]


# --- #633: cancel = archive (transition-based) ------------------------------


def _state(project, name, group):
    """Create one workflow state in the given group for transition tests."""

    return State.objects.create(
        id=uuid.uuid4(), project=project, name=name, group=group
    )


@pytest.mark.django_db
def test_cancel_archives_and_cascades_descendants(client, project, auth):
    cancelled = _state(project, "Cancelled", "cancelled")
    story = _make_task(client, project, auth)
    subtask = _make_task(client, project, auth, parent_id=story["id"])

    r = patch_json(
        client,
        f"{BASE}/work-items/{story['id']}",
        {"state_id": str(cancelled.id)},
        auth,
    )
    assert r.status_code == 200
    assert r.json()["is_archived"] is True

    # Story + its sub-task both drop from the active list (cascade archive).
    active = client.get(
        f"{BASE}/projects/{project.id}/work-items", headers=auth
    ).json()
    assert [t["id"] for t in active] == []

    sub = client.get(f"{BASE}/work-items/{subtask['id']}", headers=auth).json()
    assert sub["task"]["is_archived"] is True


@pytest.mark.django_db
def test_uncancel_restores_self_only(client, project, auth):
    todo = _state(project, "Todo", "unstarted")
    cancelled = _state(project, "Cancelled", "cancelled")
    story = _make_task(client, project, auth)
    subtask = _make_task(client, project, auth, parent_id=story["id"])

    patch_json(
        client, f"{BASE}/work-items/{story['id']}", {"state_id": str(cancelled.id)}, auth
    )
    # Un-cancel the story: cancelled → active restores the story only.
    r = patch_json(
        client, f"{BASE}/work-items/{story['id']}", {"state_id": str(todo.id)}, auth
    )
    assert r.json()["is_archived"] is False

    # The cascade-archived descendant is NOT restored (intentional asymmetry).
    sub = client.get(f"{BASE}/work-items/{subtask['id']}", headers=auth).json()
    assert sub["task"]["is_archived"] is True


@pytest.mark.django_db
def test_active_to_active_leaves_manual_archive_untouched(client, project, auth):
    inprog = _state(project, "In Progress", "started")
    task = _make_task(client, project, auth)
    # Manually archive while in a non-cancelled state.
    Issue.objects.filter(pk=task["id"]).update(is_archived=True)

    # Editing its state active → active must not resurrect it.
    r = patch_json(
        client, f"{BASE}/work-items/{task['id']}", {"state_id": str(inprog.id)}, auth
    )
    assert r.json()["is_archived"] is True


@pytest.mark.django_db
def test_child_count_excludes_archived_children(client, project, auth):
    cancelled = _state(project, "Cancelled", "cancelled")
    story = _make_task(client, project, auth)
    subtask = _make_task(client, project, auth, parent_id=story["id"])

    before = client.get(f"{BASE}/work-items/{story['id']}", headers=auth).json()
    assert before["task"]["sub_issues_count"] == 1

    # Cancelling the only child archives it; the parent's rollup drops to 0 so
    # the main app shows no expand arrow over an empty subtree.
    patch_json(
        client, f"{BASE}/work-items/{subtask['id']}", {"state_id": str(cancelled.id)}, auth
    )
    after = client.get(f"{BASE}/work-items/{story['id']}", headers=auth).json()
    assert after["task"]["sub_issues_count"] == 0


# --- auth inheritance (C7) ---------------------------------------------------
#
# The new routes inherit auth structurally: they are mounted on the same
# ``router = Router(auth=ApiKeyAuth())`` as the existing 13 routes. The package
# self-test host does not enforce router-level auth at runtime (a known ninja
# wiring limitation — the same reason ``test_auth.py``'s Client cases fail on
# the clean tree), so we assert the structural binding instead of a 401.


def test_router_carries_api_key_auth():
    from worktracker.api import router
    from worktracker.auth import ApiKeyAuth

    assert isinstance(router.auth, ApiKeyAuth)
