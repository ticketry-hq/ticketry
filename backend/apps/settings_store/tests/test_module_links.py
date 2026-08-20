import uuid

import pytest
from django.db import IntegrityError, transaction

from apps.settings_store.models import ModuleLink
from apps.settings_store.module_links import resolve_module_path
from worktracker.models import Issue, IssueType, Project


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


@pytest.fixture
def module_rows():
    project = Project.objects.create(id=uuid.uuid4(), name="Links", slug="LINKS")
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    task_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Task", level="task"
    )
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Module",
        sequence_id=1,
    )
    task = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=task_type,
        module=module,
        name="Task",
        sequence_id=2,
    )
    return module, task


def test_list_upsert_replace_delete_and_protected_fields(client, module_rows, tmp_path):
    module, _ = module_rows
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    supplied_id = uuid.uuid4()

    created = client.put(
        f"/api/module-links/{module.id}",
        data={
            "id": str(supplied_id),
            "module_id": str(uuid.uuid4()),
            "local_path": str(first),
            "created_at": "2000-01-01T00:00:00Z",
        },
        content_type="application/json",
    )

    assert created.status_code == 200
    body = created.json()
    assert body["id"] != str(supplied_id)
    assert body["module_id"] == str(module.id)
    assert body["local_path"] == str(first)
    assert client.get("/api/module-links").json() == [body]

    replaced = client.put(
        f"/api/module-links/{module.id}",
        data={"local_path": str(second)},
        content_type="application/json",
    )
    assert replaced.status_code == 200
    assert replaced.json()["id"] == body["id"]
    assert replaced.json()["local_path"] == str(second)
    assert ModuleLink.objects.filter(module=module).count() == 1

    deleted = client.delete(f"/api/module-links/{module.id}")
    assert deleted.status_code == 204
    assert ModuleLink.objects.count() == 0
    assert client.delete(f"/api/module-links/{module.id}").status_code == 404


@pytest.mark.parametrize("target", ["unknown", "task"])
def test_upsert_rejects_unknown_and_non_module_work_items(
    client, module_rows, tmp_path, target
):
    _, task = module_rows
    module_id = uuid.uuid4() if target == "unknown" else task.id

    response = client.put(
        f"/api/module-links/{module_id}",
        data={"local_path": str(tmp_path)},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert ModuleLink.objects.count() == 0


@pytest.mark.parametrize("local_path", ["relative/path", "/path/that/does/not/exist"])
def test_invalid_path_does_not_replace_an_existing_link(
    client, module_rows, tmp_path, local_path
):
    module, _ = module_rows
    ModuleLink.objects.create(module=module, local_path=str(tmp_path))

    response = client.put(
        f"/api/module-links/{module.id}",
        data={"local_path": local_path},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert ModuleLink.objects.get(module=module).local_path == str(tmp_path)


def test_database_uniqueness_and_module_cascade(module_rows, tmp_path):
    module, _ = module_rows
    ModuleLink.objects.create(module=module, local_path=str(tmp_path))

    with pytest.raises(IntegrityError), transaction.atomic():
        ModuleLink.objects.create(module=module, local_path=str(tmp_path))

    module.delete()
    assert ModuleLink.objects.count() == 0


def test_runtime_resolution_uses_only_typed_link(module_rows, tmp_path):
    module, _ = module_rows
    typed = tmp_path / "typed"
    typed.mkdir()

    assert resolve_module_path(module.id) is None

    ModuleLink.objects.create(module=module, local_path=str(typed))
    assert resolve_module_path(module.id) == str(typed)


def test_worktree_and_shell_runtime_use_the_typed_link(
    module_rows, tmp_path, monkeypatch
):
    from apps.terminals import shell_launch
    from apps.worktrees.api import _module_folder

    module, _ = module_rows
    typed = tmp_path / "typed"
    typed.mkdir()
    ModuleLink.objects.create(module=module, local_path=str(typed))

    assert _module_folder(str(module.id)) == str(typed)
    assert shell_launch.resolve_module_shell_directory(str(module.id)) == str(typed)
