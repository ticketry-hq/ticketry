"""Mutation routes and retained archived-item filtering behavior."""

import uuid

import pytest

from worktracker.models import Issue, IssueType, IssueTypeTransition, Project, State
from worktracker.tests.conftest import BASE, patch_json, post_json


# --- helpers ----------------------------------------------------------------


def _make_task(client, project, auth, name="T", parent_id=None, state_id=None):
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name="Task",
        defaults={"id": uuid.uuid4(), "level": "task"},
    )
    body = {"name": name, "issue_type_id": str(issue_type.id)}
    if parent_id:
        body["parent_id"] = parent_id
    if state_id:
        body["state_id"] = str(state_id)
    r = post_json(client, f"{BASE}/projects/{project.id}/work-items", body, auth)
    assert r.status_code == 201
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
    assert r.status_code == 201
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
        {"name": "Second", "slug": "SEC"},
        auth,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["slug"] == "SEC"

    created = Project.objects.get(id=body["id"])
    assert created.seq_counter == 0
    # The canonical states are seeded so the project is board-ready
    # (CODIN-859); every reviewed state carries the protected flag.
    assert State.objects.filter(project=created).count() == 8
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
        "Ideas",
        "Grill",
        "Spec",
        "Tickets",
        "Implement",
        "Review",
        "Done",
        "Cancelled",
    }


@pytest.mark.django_db
def test_create_project_needs_no_parent_identity(client, project, auth):
    r = post_json(client, f"{BASE}/projects", {"name": "NoWs", "slug": "NWS"}, auth)
    assert r.status_code == 201
    assert Project.objects.filter(slug="NWS").exists()


@pytest.mark.django_db
def test_create_project_duplicate_slug_409(client, project, auth):
    Project.objects.create(
        id=uuid.uuid4(),
        name="Existing",
        slug="DUP",
    )
    r = post_json(
        client,
        f"{BASE}/projects",
        {"name": "Dup", "slug": "DUP"},
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
    assert r.status_code == 201
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
    # A description patch that also tries to mutate the immutable slug is rejected.
    r = patch_json(
        client,
        f"{BASE}/projects/{project.id}",
        {"description": "updated", "slug": "HACK"},
        auth,
    )
    assert r.status_code == 400
    assert "immutable" in str(r.json()["slug"]).lower()
    project.refresh_from_db()
    assert project.description == ""
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


# --- #633: cancel = archive (transition-based) ------------------------------


def _state(project, name, group):
    """Create one workflow state in the given group for transition tests."""

    return State.objects.create(
        id=uuid.uuid4(), project=project, name=name, group=group
    )


def _workflow(project, start, *edges):
    issue_type = _task_type(project)
    issue_type.start_state = start
    issue_type.save(update_fields=("start_state", "updated_at"))
    IssueTypeTransition.objects.bulk_create(
        [
            IssueTypeTransition(
                issue_type=issue_type,
                from_state=from_state,
                to_state=to_state,
            )
            for from_state, to_state in edges
        ]
    )


@pytest.mark.django_db
def test_cancel_archives_and_cascades_descendants(client, project, auth):
    todo = _state(project, "Todo", "unstarted")
    cancelled = _state(project, "Cancelled", "cancelled")
    _workflow(project, todo, (todo, cancelled))
    story = _make_task(client, project, auth, state_id=todo.id)
    subtask = _make_task(
        client, project, auth, parent_id=story["id"], state_id=todo.id
    )

    r = patch_json(
        client,
        f"{BASE}/work-items/{story['id']}",
        {"state_id": str(cancelled.id)},
        auth,
    )
    assert r.status_code == 200
    assert r.json()["is_archived"] is True

    # The collection read hides nothing (clients filter on is_archived); the
    # cascade shows as both the story and its sub-task carrying the flag.
    listed = client.get(f"{BASE}/work-items?project={project.id}", headers=auth).json()
    archived = {t["id"]: t["is_archived"] for t in listed}
    assert archived == {story["id"]: True, subtask["id"]: True}

    sub = client.get(f"{BASE}/work-items/{subtask['id']}", headers=auth).json()
    assert sub["is_archived"] is True


@pytest.mark.django_db
def test_uncancel_restores_self_only(client, project, auth):
    todo = _state(project, "Todo", "unstarted")
    cancelled = _state(project, "Cancelled", "cancelled")
    _workflow(project, todo, (todo, cancelled), (cancelled, todo))
    story = _make_task(client, project, auth, state_id=todo.id)
    subtask = _make_task(
        client, project, auth, parent_id=story["id"], state_id=todo.id
    )

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
    assert sub["is_archived"] is True


@pytest.mark.django_db
def test_active_to_active_leaves_manual_archive_untouched(client, project, auth):
    todo = _state(project, "Todo", "unstarted")
    inprog = _state(project, "In Progress", "started")
    _workflow(project, todo, (todo, inprog))
    task = _make_task(client, project, auth, state_id=todo.id)
    # Manually archive while in a non-cancelled state.
    Issue.objects.filter(pk=task["id"]).update(is_archived=True)

    # Editing its state active → active must not resurrect it.
    r = patch_json(
        client, f"{BASE}/work-items/{task['id']}", {"state_id": str(inprog.id)}, auth
    )
    assert r.json()["is_archived"] is True


@pytest.mark.django_db
def test_child_count_excludes_archived_children(client, project, auth):
    todo = _state(project, "Todo", "unstarted")
    cancelled = _state(project, "Cancelled", "cancelled")
    _workflow(project, todo, (todo, cancelled))
    story = _make_task(client, project, auth, state_id=todo.id)
    subtask = _make_task(
        client, project, auth, parent_id=story["id"], state_id=todo.id
    )

    before = client.get(f"{BASE}/work-items/{story['id']}", headers=auth).json()
    assert before["sub_issues_count"] == 1

    # Cancelling the only child archives it; the parent's rollup drops to 0 so
    # the main app shows no expand arrow over an empty subtree.
    patch_json(
        client, f"{BASE}/work-items/{subtask['id']}", {"state_id": str(cancelled.id)}, auth
    )
    after = client.get(f"{BASE}/work-items/{story['id']}", headers=auth).json()
    assert after["sub_issues_count"] == 0
