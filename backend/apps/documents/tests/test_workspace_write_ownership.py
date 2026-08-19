"""The checked Slice 4 ownership closure at the Django boundary.

The claim this file has to earn is narrow and absolute: after the handoff no
Django path — ORM save, queryset write, raw SQL, admin action, signal receiver,
startup hook, route, or shipping helper — remains a production writer for a
Rust-owned Design Document, Worktree, or Workspace Operation row. It is checked
by reading the shipping source rather than by exercising one path at a time,
because the failure this prevents is a writer nobody remembered to look for.

It lives under Documents rather than in either app because the transfer was one
event across both, and a per-app version of this file would be two half-answers.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest
from django.test import Client, override_settings

from apps.documents.admin import DesignDocumentAdmin
from apps.documents.models import DesignDocument
from apps.workspace_write_ownership import (
    OWNED_ROUTE_PREFIXES,
    OWNED_TABLES,
    RUST_OWNER_ENV,
    assert_django_workspace_write_allowed,
    rust_owns_workspace_writes,
    workspace_runtime_ready,
)
from apps.worktrees.models import Worktree


BACKEND = Path(__file__).resolve().parents[3]

#: Django model classes mapped onto the Rust-owned tables they read.
OWNED_MODELS = ("DesignDocument", "Worktree")

#: The ORM calls that write. Reading is still allowed: unmigrated capabilities
#: consume workspace projections until their own slices land.
WRITING_CALLS = {
    "save",
    "asave",
    "create",
    "acreate",
    "update",
    "aupdate",
    "delete",
    "adelete",
    "bulk_create",
    "abulk_create",
    "bulk_update",
    "abulk_update",
    "get_or_create",
    "aget_or_create",
    "update_or_create",
    "aupdate_or_create",
}

#: Shipping modules whose owned-model writes are the guard itself: the model's
#: refusing `save`/`delete` override, and the DAO helpers that repeat the refusal
#: because a queryset write bypasses the model. Every one of them raises after the
#: handoff; none of them is a writer.
GUARDED_WRITE_MODULES = {
    "apps/documents/models.py",
    "apps/documents/dao/registry.py",
    "apps/worktrees/models.py",
    "apps/worktrees/dao/worktree.py",
    "apps/worktrees/service/actions.py",
}


def _shipping_modules() -> list[Path]:
    """Every shipping Python module: no tests, no migrations, no packaging."""

    return [
        path
        for path in BACKEND.rglob("*.py")
        if "/tests/" not in str(path)
        and "/migrations/" not in str(path)
        and "/packaging/" not in str(path)
        and ".venv" not in str(path)
        and not path.name.startswith("test_")
    ]


def _owned_model_writes(source: str) -> list[str]:
    """Find `<OwnedModel>.objects.<writer>(...)` and `<row>.save(...)` calls."""

    violations: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr not in WRITING_CALLS:
            continue
        target = node.func.value
        names: list[str] = []
        while isinstance(target, (ast.Attribute, ast.Call, ast.Subscript)):
            if isinstance(target, ast.Attribute):
                names.append(target.attr)
                target = target.value
            elif isinstance(target, ast.Call):
                target = target.func
            else:
                target = target.value
        if isinstance(target, ast.Name):
            names.append(target.id)
        if any(name in OWNED_MODELS for name in names):
            violations.append(f"{'.'.join(reversed(names))}.{node.func.attr}")
    return violations


def test_only_the_guarded_modules_write_a_rust_owned_workspace_table():
    violations: dict[str, list[str]] = {}
    for path in _shipping_modules():
        relative = str(path.relative_to(BACKEND))
        if relative in GUARDED_WRITE_MODULES:
            continue
        writes = _owned_model_writes(path.read_text(encoding="utf-8"))
        if writes:
            violations[relative] = writes

    assert violations == {}, (
        "Rust is the sole production writer for every workspace table after the "
        f"Slice 4 handoff, but these modules still write one: {violations}"
    )


@pytest.mark.parametrize("module", sorted(GUARDED_WRITE_MODULES))
def test_every_module_that_writes_an_owned_table_calls_the_guard(module):
    """A declared write module earns its place by refusing, not by being listed."""

    source = (BACKEND / module).read_text(encoding="utf-8")

    assert "assert_django_workspace_write_allowed" in source, (
        f"{module} writes an owned table without installing the refusal"
    )


MUTATING_SQL = ("INSERT INTO", "UPDATE ", "DELETE FROM", "ALTER TABLE", "DROP TABLE")


def test_no_shipping_module_executes_mutating_raw_sql_against_an_owned_table():
    """Reads may still join an owned table; nothing may write one."""

    offenders: dict[str, list[str]] = {}
    for path in _shipping_modules():
        source = path.read_text(encoding="utf-8")
        if "cursor.execute" not in source and ".raw(" not in source:
            continue
        upper = source.upper()
        if not any(statement in upper for statement in MUTATING_SQL):
            continue
        hits = [table for table in OWNED_TABLES if table in source]
        if hits:
            offenders[str(path.relative_to(BACKEND))] = hits

    assert offenders == {}, (
        f"mutating raw SQL still names a Rust-owned workspace table: {offenders}"
    )


def test_no_shipping_module_declares_a_model_for_the_operation_journal():
    """The journal has never had a Django writer and must never acquire one."""

    offenders = [
        str(path.relative_to(BACKEND))
        for path in _shipping_modules()
        if 'db_table = "workspace_operations"' in path.read_text(encoding="utf-8")
    ]

    assert offenders == []


def test_no_signal_receiver_or_startup_hook_drives_a_workspace_effect():
    """The close hook and the pruning startup pass are gone, not merely unused."""

    assert not (BACKEND / "apps/worktrees/signals.py").exists()
    assert not (BACKEND / "apps/documents/watch.py").exists()

    apps_config = (BACKEND / "apps/worktrees/apps.py").read_text(encoding="utf-8")
    assert "signals" not in apps_config or "No signal receivers" in apps_config

    asgi = (BACKEND / "studio_server/asgi.py").read_text(encoding="utf-8")
    assert "worktrees_service.reconcile" not in asgi
    assert "documents_watch" not in asgi


def test_the_admin_refuses_every_mutation_of_an_owned_model():
    admin = DesignDocumentAdmin(DesignDocument, None)

    assert admin.has_add_permission(None) is False
    assert admin.has_change_permission(None) is False
    assert admin.has_delete_permission(None) is False


def test_the_guard_is_dormant_until_ownership_is_installed(monkeypatch):
    monkeypatch.delenv(RUST_OWNER_ENV, raising=False)

    assert rust_owns_workspace_writes() is False
    assert workspace_runtime_ready() is False
    # A dormant guard must not raise: the pre-cutover build still runs.
    assert assert_django_workspace_write_allowed("design_documents") is None


def test_the_guard_fails_closed_for_non_http_writers_after_the_handoff(monkeypatch):
    monkeypatch.setenv(RUST_OWNER_ENV, "1")

    assert rust_owns_workspace_writes() is True
    for table in ("design_documents", "worktrees"):
        with pytest.raises(RuntimeError, match="django_slice4_write_disabled"):
            assert_django_workspace_write_allowed(table)


def test_the_models_themselves_refuse_after_the_handoff(monkeypatch):
    """The refusal is structural: it does not depend on going through a DAO."""

    monkeypatch.setenv(RUST_OWNER_ENV, "1")

    with pytest.raises(RuntimeError, match="django_slice4_write_disabled"):
        DesignDocument(id="d1").save()
    with pytest.raises(RuntimeError, match="django_slice4_write_disabled"):
        Worktree(id="w1").save()
    with pytest.raises(RuntimeError, match="django_slice4_write_disabled"):
        DesignDocument(id="d1").delete()
    with pytest.raises(RuntimeError, match="django_slice4_write_disabled"):
        Worktree(id="w1").delete()


COMPLETE_READINESS = {
    "version": 1,
    "documents_ownership": True,
    "worktree_ownership": True,
    "operation_journal_ownership": True,
    "ownership_validated": True,
    "status_outbox": True,
    "operation_reconciliation": True,
    "authorized_roots": True,
    "graphql_workspace": True,
    "asset_protocol": True,
    "document_watch": True,
    "ready": True,
    "django_write_fallback": False,
}


def test_readiness_requires_the_exact_published_record(monkeypatch, tmp_path):
    monkeypatch.setenv(RUST_OWNER_ENV, "1")
    monkeypatch.setenv("MUXED_DATA_DIR", str(tmp_path))
    record = tmp_path / "slice4-readiness.json"

    assert workspace_runtime_ready() is False  # nothing published yet

    for field in (
        "documents_ownership",
        "worktree_ownership",
        "operation_journal_ownership",
        "ownership_validated",
        "operation_reconciliation",
        "asset_protocol",
        "document_watch",
    ):
        record.write_text(json.dumps({**COMPLETE_READINESS, field: False, "ready": False}))
        assert workspace_runtime_ready() is False

    record.write_text(json.dumps({**COMPLETE_READINESS, "unknown": True}))
    assert workspace_runtime_ready() is False

    record.write_text(json.dumps({**COMPLETE_READINESS, "django_write_fallback": True}))
    assert workspace_runtime_ready() is False

    record.write_text(json.dumps(COMPLETE_READINESS))
    assert workspace_runtime_ready() is True


@pytest.mark.django_db
@override_settings(WORKTRACKER_DISABLE_AUTH=True)
@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/documents?task_id=t1"),
        ("get", "/api/docs/d1/SPEC.md"),
        ("put", "/api/docs/d1"),
        ("get", "/api/fs/complete?path=/tmp"),
        ("get", "/api/worktrees?task_id=t1"),
        ("post", "/api/worktrees/t1/create"),
        ("post", "/api/worktrees/t1/discard"),
    ],
)
def test_every_legacy_workspace_route_refuses_after_the_handoff(monkeypatch, method, path):
    monkeypatch.setenv(RUST_OWNER_ENV, "1")
    client = Client()

    refused = getattr(client, method)(path)

    assert refused.status_code == 410, path
    assert refused.json()["code"] == "django_slice4_write_disabled"


def test_the_declared_prefixes_cover_every_retired_workspace_route():
    """The registry and the refusal must name the same surface."""

    from worktracker.registry import HOST_ROUTES

    retired = {
        route.path
        for route in HOST_ROUTES
        if route.purpose.startswith("Retired:")
        and any(route.path.startswith(prefix) for prefix in OWNED_ROUTE_PREFIXES)
    }

    assert retired == {
        "/api/documents",
        "/api/docs/{doc_id}/{asset_path}",
        "/api/docs/{doc_id}",
        "/api/fs/complete",
        "/api/worktrees",
        "/api/worktrees/{task_id}/create",
        "/api/worktrees/{task_id}/discard",
    }
