import json
import logging
import uuid

import pytest
from worktracker.models import Issue, IssueType, Project

from apps.settings_store.legacy_module_link_import import import_legacy_module_links
from apps.settings_store.models import ModuleLink

pytestmark = pytest.mark.django_db


@pytest.fixture
def modules():
    project = Project.objects.create(id=uuid.uuid4(), name="Import", slug="IMPORT")
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    return [
        Issue.objects.create(
            id=uuid.uuid4(),
            project=project,
            type="module",
            issue_type=module_type,
            name=f"Module {index}",
            sequence_id=index,
        )
        for index in (1, 2)
    ]


def _write_legacy_files(data_dir, profiles):
    data_dir.mkdir()
    (data_dir / "profiles.json").write_text(json.dumps({"profiles": profiles}))
    (data_dir / "features.json").write_text("not inspected")


def test_import_keeps_valid_entries_skips_partial_entries_and_uses_last_duplicate(
    tmp_path, modules, caplog
):
    first, second = modules
    first_path = tmp_path / "first"
    replacement_path = tmp_path / "replacement"
    second_path = tmp_path / "second"
    first_path.mkdir()
    replacement_path.mkdir()
    second_path.mkdir()
    missing_module = uuid.uuid4()
    missing_path = tmp_path / "missing"
    data_dir = tmp_path / "isolated-data"
    _write_legacy_files(
        data_dir,
        [
            {
                "module_folders": {str(first.id): str(first_path)},
                "module_links": [
                    {"module_id": str(second.id), "path": str(second_path)},
                    {"module_id": str(first.id), "path": str(replacement_path)},
                    {"module_id": str(missing_module), "path": str(second_path)},
                    {"module_id": str(second.id)},
                    {"path": str(second_path)},
                    "broken",
                ],
            },
            {
                "module_links": [
                    {"module_id": str(second.id), "path": str(missing_path)}
                ]
            },
            "broken profile",
        ],
    )

    with caplog.at_level(logging.WARNING):
        imported = import_legacy_module_links(data_dir)

    assert imported == 4
    assert dict(ModuleLink.objects.values_list("module_id", "local_path")) == {
        first.id: str(replacement_path),
        second.id: str(missing_path),
    }
    assert "skipped module" in caplog.text
    assert "missing module id" in caplog.text
    assert "not an object" in caplog.text
    assert not (data_dir / "profiles.json").exists()
    assert not (data_dir / "features.json").exists()


def test_import_persists_a_link_when_its_module_folder_is_offline(tmp_path, modules):
    module, _ = modules
    offline_path = "/Volumes/offline/code/app"
    data_dir = tmp_path / "isolated-data"
    _write_legacy_files(
        data_dir,
        [{"module_links": [{"module_id": str(module.id), "path": offline_path}]}],
    )

    assert import_legacy_module_links(data_dir) == 1
    assert ModuleLink.objects.get(module=module).local_path == offline_path
    assert not (data_dir / "profiles.json").exists()
    assert not (data_dir / "features.json").exists()


def test_malformed_file_is_logged_deleted_and_second_run_is_a_noop(
    tmp_path, modules, caplog
):
    data_dir = tmp_path / "isolated-data"
    data_dir.mkdir()
    (data_dir / "profiles.json").write_text("{malformed")
    (data_dir / "features.json").write_text("{also malformed")

    with caplog.at_level(logging.WARNING):
        assert import_legacy_module_links(data_dir) == 0

    assert ModuleLink.objects.count() == 0
    assert "could not read" in caplog.text
    assert not (data_dir / "profiles.json").exists()
    assert not (data_dir / "features.json").exists()

    caplog.clear()
    assert import_legacy_module_links(data_dir) == 0
    assert caplog.text == ""
