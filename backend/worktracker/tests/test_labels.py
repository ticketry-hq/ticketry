"""C8 / G06 — name-based editable labels + G07 timestamps on WorkItemOut.

Exercises the ``labels`` replace-set patch field through the package's ninja
host: add / remove / clear, name-based get-or-create reuse, project scoping,
normalization, and the ``color`` projection. Plus the additive ``created_at`` /
``updated_at`` timestamps on the work-item output.
"""

import uuid

import pytest

from worktracker.models import Label, Project, Workspace
from worktracker.tests.conftest import BASE, patch_json, post_json


def _task(client, project, auth, name):
    """Create a project task and return its JSON."""
    r = post_json(
        client, f"{BASE}/projects/{project.id}/work-items", {"name": name}, auth
    )
    assert r.status_code == 200
    return r.json()


@pytest.mark.django_db
def test_patch_adds_labels_by_name(client, project, auth):
    a = _task(client, project, auth, "A")

    r = patch_json(
        client, f"{BASE}/work-items/{a['id']}", {"labels": ["backend", "infra"]}, auth
    )
    assert r.status_code == 200
    names = [label["name"] for label in r.json()["labels"]]
    assert sorted(names) == ["backend", "infra"]
    # Name-created labels start blank → color is "" (neutral on the FE).
    assert all(label["color"] == "" for label in r.json()["labels"])
    assert Label.objects.filter(project=project).count() == 2


@pytest.mark.django_db
def test_patch_replaces_label_set(client, project, auth):
    a = _task(client, project, auth, "A")
    patch_json(client, f"{BASE}/work-items/{a['id']}", {"labels": ["x", "y"]}, auth)

    r = patch_json(client, f"{BASE}/work-items/{a['id']}", {"labels": ["y"]}, auth)
    assert r.status_code == 200
    assert [label["name"] for label in r.json()["labels"]] == ["y"]


@pytest.mark.django_db
def test_present_empty_list_clears_labels(client, project, auth):
    a = _task(client, project, auth, "A")
    patch_json(client, f"{BASE}/work-items/{a['id']}", {"labels": ["x"]}, auth)

    r = patch_json(client, f"{BASE}/work-items/{a['id']}", {"labels": []}, auth)
    assert r.status_code == 200
    assert r.json()["labels"] == []
    # The label row is left behind (reused for autocomplete), only the M2M drops.
    assert Label.objects.filter(project=project, name="x").exists()


@pytest.mark.django_db
def test_absent_field_leaves_labels_untouched(client, project, auth):
    a = _task(client, project, auth, "A")
    patch_json(client, f"{BASE}/work-items/{a['id']}", {"labels": ["keep"]}, auth)

    r = patch_json(client, f"{BASE}/work-items/{a['id']}", {"name": "renamed"}, auth)
    assert r.status_code == 200
    assert [label["name"] for label in r.json()["labels"]] == ["keep"]


@pytest.mark.django_db
def test_get_or_create_reuses_existing_label(client, project, auth):
    a = _task(client, project, auth, "A")
    b = _task(client, project, auth, "B")
    patch_json(client, f"{BASE}/work-items/{a['id']}", {"labels": ["shared"]}, auth)
    patch_json(client, f"{BASE}/work-items/{b['id']}", {"labels": ["shared"]}, auth)

    # One row, two issues — not two homonymous labels.
    assert Label.objects.filter(project=project, name="shared").count() == 1


@pytest.mark.django_db
def test_color_is_projected_when_set(client, project, auth):
    a = _task(client, project, auth, "A")
    # A pre-existing colored label is reused (color preserved, not overwritten).
    Label.objects.create(
        id=uuid.uuid4(), project=project, name="bug", color="#f7768e"
    )
    r = patch_json(client, f"{BASE}/work-items/{a['id']}", {"labels": ["bug"]}, auth)
    assert r.status_code == 200
    assert r.json()["labels"][0] == {"name": "bug", "color": "#f7768e"}
    assert Label.objects.filter(project=project, name="bug").count() == 1


@pytest.mark.django_db
def test_names_are_trimmed_and_deduped(client, project, auth):
    a = _task(client, project, auth, "A")
    r = patch_json(
        client,
        f"{BASE}/work-items/{a['id']}",
        {"labels": [" tidy ", "tidy", "", "  "]},
        auth,
    )
    assert r.status_code == 200
    assert [label["name"] for label in r.json()["labels"]] == ["tidy"]


@pytest.mark.django_db
def test_match_is_case_sensitive(client, project, auth):
    a = _task(client, project, auth, "A")
    r = patch_json(
        client, f"{BASE}/work-items/{a['id']}", {"labels": ["Backend", "backend"]}, auth
    )
    assert r.status_code == 200
    assert Label.objects.filter(project=project).count() == 2


@pytest.mark.django_db
def test_labels_are_project_scoped(client, project, auth):
    """A homonymous label in another project is never reused across projects."""
    other = Project.objects.create(
        id=uuid.uuid4(),
        workspace=Workspace.objects.get(slug="meml"),
        name="other",
        slug="OTHER",
    )
    Label.objects.create(id=uuid.uuid4(), project=other, name="dup")

    a = _task(client, project, auth, "A")
    patch_json(client, f"{BASE}/work-items/{a['id']}", {"labels": ["dup"]}, auth)

    assert Label.objects.filter(name="dup").count() == 2
    assert Label.objects.filter(project=project, name="dup").count() == 1


@pytest.mark.django_db
def test_work_item_out_exposes_timestamps(client, project, auth):
    a = _task(client, project, auth, "A")
    assert "created_at" in a
    assert "updated_at" in a
    assert a["created_at"] and a["updated_at"]

    r = client.get(f"{BASE}/work-items/{a['id']}", headers=auth)
    task = r.json()["task"]
    assert task["created_at"] and task["updated_at"]
