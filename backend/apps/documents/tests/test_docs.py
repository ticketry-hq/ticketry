"""Tests for registered-document serving and the documents listing (#521).

Covers the acceptance criteria for serving and restore:
- A registered document and its relative assets serve from the path-style
  endpoint with the right media types and no-store/nosniff headers.
- Traversal, symlink escapes, unknown documents and disallowed extensions
  are all a uniform 404 — the boundary comes from the registry.
- Authenticated primary-Markdown saves are digest guarded and cannot target
  relative assets or escape the registered boundary.
- ``GET /api/documents`` lists registered rows and rescans every known
  boundary, including the recalculated canonical task directory, so files
  written without a watcher (planning promotion, downtime) are discovered.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

from apps.documents.models import DesignDocument
from apps.documents.tests.conftest import write_profiles
from apps.runs.models import AgentRun


pytestmark = pytest.mark.django_db(transaction=True)
SCRATCH = "00000000-0000-0000-0000-000000000000"


def _register_doc(
    *,
    doc_id: str,
    root_dir: str,
    rel_path: str,
    task_id: str = "t1",
    module_id: str = "m1",
) -> None:
    DesignDocument.objects.create(
        id=doc_id,
        module_id=module_id,
        task_id=task_id,
        scope="task",
        root_dir=root_dir,
        rel_path=rel_path,
        discovered_by_run_id="run-1",
        created_at="2026-06-11T10:00:00",
        updated_at="2026-06-11T10:00:00",
    )


def _insert_run_with_design_dir(
    run_id: str, design_dir: str, *, task_id: str = "t1", module_id: str = "m1"
) -> None:
    AgentRun.objects.create(
        id=run_id,
        project_id="p1",
        module_id=module_id,
        task_id=task_id,
        agent="claude",
        status="running",
        started_at="2026-06-11T10:00:00",
        design_dir=design_dir,
    )


def _seed_design_dir(tmp_path: Path) -> Path:
    root = tmp_path / "spec" / "m--1" / "T9--x"
    (root / "img").mkdir(parents=True)
    (root / "design.html").write_text("<html><body>doc</body></html>")
    (root / "img" / "arch.svg").write_text("<svg></svg>")
    (root / "run.sh").write_text("echo nope")
    return root


# ---------- serving ----------


def test_serves_registered_html(client, tmp_path):
    root = _seed_design_dir(tmp_path)
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="design.html")

    resp = client.get("/api/docs/d1/design.html")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    assert resp.headers.get("cache-control") == "no-store"
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert b"doc" in resp.getvalue()


def test_serves_registered_markdown(client, tmp_path):
    root = _seed_design_dir(tmp_path)
    spec = root / "SPEC.MD"
    spec.write_text("# Safe spec")
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="SPEC.MD")

    resp = client.get("/api/docs/d1/SPEC.MD")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/markdown")
    assert b"# Safe spec" in resp.getvalue()
    assert resp.headers["etag"] == f'"{hashlib.sha256(resp.getvalue()).hexdigest()}"'

    first_digest = resp.headers["etag"]
    spec.write_text("# Changed spec")

    changed = client.get("/api/docs/d1/SPEC.MD")
    assert changed.status_code == 200
    assert changed.headers["etag"] != first_digest
    assert changed.headers["etag"] == (
        f'"{hashlib.sha256(changed.getvalue()).hexdigest()}"'
    )


def test_serves_relative_asset_inside_boundary(client, tmp_path):
    root = _seed_design_dir(tmp_path)
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="design.html")

    resp = client.get("/api/docs/d1/img/arch.svg")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/svg+xml")


def test_rejects_parent_traversal(client, tmp_path):
    root = _seed_design_dir(tmp_path)
    (tmp_path / "secret.html").write_text("<html>secret</html>")
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="design.html")

    resp = client.get("/api/docs/d1/../../../secret.html")
    assert resp.status_code == 404


def test_rejects_symlink_escape(client, tmp_path):
    root = _seed_design_dir(tmp_path)
    outside = tmp_path / "outside.html"
    outside.write_text("<html>outside</html>")
    os.symlink(outside, root / "link.html")
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="design.html")

    resp = client.get("/api/docs/d1/link.html")
    assert resp.status_code == 404


def test_rejects_unknown_document(client, tmp_path):
    resp = client.get("/api/docs/nope/design.html")
    assert resp.status_code == 404


def test_rejects_disallowed_extension(client, tmp_path):
    root = _seed_design_dir(tmp_path)
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="design.html")

    resp = client.get("/api/docs/d1/run.sh")
    assert resp.status_code == 404


# ---------- saving ----------


def _save(client, doc_id: str, *, content: str, digest: str, headers=None):
    return client.put(
        f"/api/docs/{doc_id}",
        data=json.dumps({"content": content, "digest": digest}),
        content_type="application/json",
        headers=headers or {},
    )


def test_authenticated_save_persists_registered_markdown_and_returns_digest(
    client, tmp_path, settings
):
    settings.WORKTRACKER_API_TOKEN = "secret"
    settings.WORKTRACKER_DISABLE_AUTH = False
    root = _seed_design_dir(tmp_path)
    spec = root / "SPEC.md"
    spec.write_text("# Before")
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="SPEC.md")
    digest = hashlib.sha256(spec.read_bytes()).hexdigest()

    resp = _save(
        client,
        "d1",
        content="# After",
        digest=f'"{digest}"',
        headers={"x-api-key": "secret"},
    )

    expected = hashlib.sha256(b"# After").hexdigest()
    assert resp.status_code == 200
    assert resp.json() == {"digest": expected}
    assert resp.headers["etag"] == f'"{expected}"'
    assert spec.read_bytes() == b"# After"


def test_save_requires_authentication(client, tmp_path, settings):
    settings.WORKTRACKER_API_TOKEN = "secret"
    settings.WORKTRACKER_DISABLE_AUTH = False
    root = _seed_design_dir(tmp_path)
    spec = root / "SPEC.md"
    spec.write_text("# Before")
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="SPEC.md")

    resp = _save(
        client,
        "d1",
        content="# After",
        digest=hashlib.sha256(spec.read_bytes()).hexdigest(),
    )

    assert resp.status_code == 401
    assert spec.read_text() == "# Before"


def test_save_rejects_stale_digest_and_returns_current_digest(
    client, tmp_path, settings
):
    settings.WORKTRACKER_DISABLE_AUTH = True
    root = _seed_design_dir(tmp_path)
    spec = root / "SPEC.md"
    spec.write_text("# Current")
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="SPEC.md")

    resp = _save(client, "d1", content="# Mine", digest="stale")

    current = hashlib.sha256(b"# Current").hexdigest()
    assert resp.status_code == 409
    assert resp.json() == {"detail": {"error": "conflict", "digest": current}}
    assert resp.headers["etag"] == f'"{current}"'
    assert spec.read_bytes() == b"# Current"


def test_save_with_conflict_digest_overwrites_current_content(
    client, tmp_path, settings
):
    settings.WORKTRACKER_DISABLE_AUTH = True
    root = _seed_design_dir(tmp_path)
    spec = root / "SPEC.md"
    spec.write_text("# Current")
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="SPEC.md")
    current = hashlib.sha256(spec.read_bytes()).hexdigest()

    resp = _save(client, "d1", content="# Mine", digest=current)

    assert resp.status_code == 200
    assert spec.read_bytes() == b"# Mine"


@pytest.mark.parametrize(
    ("doc_id", "rel_path"),
    [
        ("missing", None),
        ("traversal", "../outside.md"),
        ("non-markdown", "design.html"),
    ],
)
def test_save_rejects_unknown_traversing_and_non_markdown_primary_documents(
    client, tmp_path, settings, doc_id, rel_path
):
    settings.WORKTRACKER_DISABLE_AUTH = True
    root = _seed_design_dir(tmp_path)
    if rel_path is not None:
        _register_doc(doc_id=doc_id, root_dir=str(root), rel_path=rel_path)

    resp = _save(client, doc_id, content="# Nope", digest="unused")

    assert resp.status_code == 404


def test_save_rejects_primary_document_symlink_escape(client, tmp_path, settings):
    settings.WORKTRACKER_DISABLE_AUTH = True
    root = _seed_design_dir(tmp_path)
    outside = tmp_path / "outside.md"
    outside.write_text("# Outside")
    os.symlink(outside, root / "SPEC.md")
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="SPEC.md")

    resp = _save(
        client,
        "d1",
        content="# Nope",
        digest=hashlib.sha256(outside.read_bytes()).hexdigest(),
    )

    assert resp.status_code == 404
    assert outside.read_text() == "# Outside"


def test_asset_path_has_no_write_route(client, tmp_path, settings):
    settings.WORKTRACKER_DISABLE_AUTH = True
    root = _seed_design_dir(tmp_path)
    asset = root / "asset.md"
    asset.write_text("# Asset")
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="design.html")

    resp = _save(
        client,
        "d1/asset.md",
        content="# Changed",
        digest=hashlib.sha256(asset.read_bytes()).hexdigest(),
    )

    assert resp.status_code in {404, 405}
    assert asset.read_text() == "# Asset"


# ---------- documents listing + rescan ----------


def test_lists_registered_documents_for_task(client, tmp_path):
    root = _seed_design_dir(tmp_path)
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="design.html")

    resp = client.get("/api/documents", {"task_id": "t1"})
    assert resp.status_code == 200
    docs = resp.json()["documents"]
    assert [d["rel_path"] for d in docs] == ["design.html"]
    assert docs[0]["label"] == "design"


def test_listing_prunes_registered_documents_missing_on_disk(client, tmp_path):
    root = _seed_design_dir(tmp_path)
    _register_doc(doc_id="d1", root_dir=str(root), rel_path="design.html")
    (root / "design.html").unlink()

    resp = client.get("/api/documents", {"task_id": "t1"})

    assert resp.status_code == 200
    assert resp.json()["documents"] == []
    assert not DesignDocument.objects.filter(id="d1").exists()


def test_rescan_registers_unseen_files_from_run_boundary(client, tmp_path):
    # A run recorded its design dir, but the file arrived with no watcher
    # alive (backend downtime): the listing's rescan registers it.

    root = _seed_design_dir(tmp_path)
    (root / "SPEC.MD").write_text("# Spec")
    _insert_run_with_design_dir("run-1", str(root))

    resp = client.get("/api/documents", {"task_id": "t1"})
    assert resp.status_code == 200
    docs = resp.json()["documents"]
    assert [d["rel_path"] for d in docs] == ["SPEC.MD", "design.html"]


def test_rescan_resolves_canonical_dir_with_zero_prior_rows(
    client, tmp_config, sample_profile, tmp_path, monkeypatch
):
    # Planning promotion: documents moved into the canonical task dir with
    # no registry rows and no run boundaries — the recalculated canonical
    # directory is what discovers them.

    module_folder = tmp_path / "repo"
    canonical = module_folder / "spec" / "platform--m1" / "T42--stub-task"
    canonical.mkdir(parents=True)
    (canonical / "plan.html").write_text("<html>plan</html>")

    profile = dict(sample_profile)
    profile["module_folders"] = {"m1": str(module_folder)}
    write_profiles(tmp_config, [profile], recent=0)

    from apps import worktracker_queries
    from studio_server.contracts import ModuleSummary, TaskDetails, TaskState, TaskSummary

    async def fake_get_modules(project_id):
        return [ModuleSummary(id="m1", name="Platform", project_id="p1")]

    async def fake_get_task_details(project_id, task_id):
        return TaskDetails(
            task=TaskSummary(
                id=task_id,
                name="Stub task",
                project_id="p1",
                sequence_id=42,
                state=TaskState(name="Todo"),
            )
        )

    monkeypatch.setattr(worktracker_queries, "get_modules", fake_get_modules)
    monkeypatch.setattr(worktracker_queries, "get_task_details", fake_get_task_details)

    resp = client.get(
        "/api/documents",
        {"task_id": "t1", "project_id": "p1", "module_id": "m1"},
    )
    assert resp.status_code == 200
    docs = resp.json()["documents"]
    assert [d["rel_path"] for d in docs] == ["plan.html"]

    # The discovered document is immediately servable.

    served = client.get(f"/api/docs/{docs[0]['id']}/plan.html")
    assert served.status_code == 200


def test_scratch_mode_lists_module_bucket(client, tmp_path):
    root = _seed_design_dir(tmp_path)
    _register_doc(
        doc_id="d1", root_dir=str(root), rel_path="design.html", task_id=SCRATCH
    )

    resp = client.get("/api/documents", {"scope": "scratch", "module_id": "m1"})
    assert resp.status_code == 200
    assert [d["rel_path"] for d in resp.json()["documents"]] == ["design.html"]

    other = client.get("/api/documents", {"scope": "scratch", "module_id": "m2"})
    assert other.json()["documents"] == []


def test_scratch_listing_prunes_missing_documents(client, tmp_path):
    root = _seed_design_dir(tmp_path)
    _register_doc(
        doc_id="d1", root_dir=str(root), rel_path="design.html", task_id=SCRATCH
    )
    (root / "design.html").unlink()

    resp = client.get("/api/documents", {"scope": "scratch", "module_id": "m1"})

    assert resp.status_code == 200
    assert resp.json()["documents"] == []


def test_scratch_mode_requires_module_id(client):
    resp = client.get("/api/documents", {"scope": "scratch"})
    assert resp.status_code == 400


def test_task_mode_requires_task_id(client):
    resp = client.get("/api/documents")
    assert resp.status_code == 400
