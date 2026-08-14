"""C6 — multipart upload to local disk + retrieve."""

from pathlib import Path

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from worktracker.tests.conftest import BASE, post_json


@pytest.fixture
def task(client, project, task_type, auth):
    return post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "T", "issue_type_id": str(task_type.id)},
        auth,
    ).json()


@pytest.mark.django_db
def test_multipart_upload_to_disk(client, project, task, auth, tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path)

    upload = SimpleUploadedFile("note.txt", b"hello", content_type="text/plain")
    r = client.post(
        f"{BASE}/work-items/{task['id']}/attachments",
        data={"file": upload},
        headers=auth,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["filename"] == "note.txt"
    assert body["mime_type"] == "text/plain"
    assert body["size"] == 5

    # The bytes landed under MEDIA_ROOT.
    stored = list(Path(tmp_path).rglob("note*.txt"))
    assert stored and stored[0].read_bytes() == b"hello"


@pytest.mark.django_db
def test_attachment_has_its_own_nested_read(
    client, project, task, auth, tmp_path, settings
):
    settings.MEDIA_ROOT = str(tmp_path)
    client.post(
        f"{BASE}/work-items/{task['id']}/attachments",
        data={"file": SimpleUploadedFile("a.txt", b"x", content_type="text/plain")},
        headers=auth,
    )

    r = client.get(f"{BASE}/work-items/{task['id']}/attachments", headers=auth)
    assert r.status_code == 200
    attachments = r.json()
    assert len(attachments) == 1
    assert attachments[0]["url"].startswith("/media/")

    bare = client.get(f"{BASE}/work-items/{task['id']}", headers=auth).json()
    assert "attachments" not in bare
