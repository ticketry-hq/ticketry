"""The checked Slice 3 ownership closure at the Django boundary.

The claim this file has to earn is narrow and absolute: after the handoff no
Django path — ORM save, raw SQL, migration, admin action, signal receiver,
route, MCP adapter, or test helper reachable from shipping code — remains a
production writer for a Rust-owned Runs table. It is checked by reading the
shipping source rather than by exercising one path at a time, because the
failure this prevents is a writer nobody remembered to look for.
"""

from __future__ import annotations

import ast
import uuid
from pathlib import Path

import pytest
from django.test import Client, override_settings

from apps.runs.admin import AgentRunAdmin
from apps.runs.models import AgentRun
from apps.runs.write_ownership import (
    OWNED_TABLES,
    RUST_OWNER_ENV,
    assert_django_runs_write_allowed,
    runs_commands_ready,
    rust_owns_runs_writes,
)


BACKEND = Path(__file__).resolve().parents[3]

#: Django model classes mapped onto the Rust-owned tables they read.
OWNED_MODELS = ("AgentRun", "AutomationAttempt")

#: The ORM calls that write. Reading is still allowed: unmigrated capabilities
#: consume Runs projections until their own slices land.
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

#: Shipping Python that is allowed to name a Rust-owned model at all. Each is a
#: read projection, a schema definition, or the checked guard itself.
READ_ONLY_MODULES = {
    "apps/runs/models.py",
    "apps/runs/admin.py",
    "apps/runs/dao/activity.py",
    "apps/runs/write_ownership.py",
    "apps/terminals/models.py",
    "apps/runs/authorization.py",
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
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr not in WRITING_CALLS:
            continue
        # Walk back down the attribute chain to its root name.
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


def test_no_shipping_module_writes_a_rust_owned_runs_table():
    violations: dict[str, list[str]] = {}
    for path in _shipping_modules():
        relative = str(path.relative_to(BACKEND))
        writes = _owned_model_writes(path.read_text(encoding="utf-8"))
        if writes:
            violations[relative] = writes

    assert violations == {}, (
        "Rust is the sole production writer for every Runs table after the "
        f"Slice 3 handoff, but these modules still write one: {violations}"
    )


def test_every_module_importing_an_owned_model_is_a_declared_read_projection():
    """A new consumer must be classified deliberately, not appear by accident.

    Importing `apps.runs.models` is the honest signal: a serializer that only
    shares a name, or a docstring that mentions one, reaches nothing.
    """

    importing: set[str] = set()
    for path in _shipping_modules():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "apps.runs.models":
                importing.add(str(path.relative_to(BACKEND)))
            elif isinstance(node, ast.Import) and any(
                alias.name == "apps.runs.models" for alias in node.names
            ):
                importing.add(str(path.relative_to(BACKEND)))

    assert importing <= READ_ONLY_MODULES, (
        "these shipping modules reach a Rust-owned Runs model without being "
        f"declared read projections: {sorted(importing - READ_ONLY_MODULES)}"
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
        f"mutating raw SQL still names a Rust-owned Runs table: {offenders}"
    )


def test_the_admin_refuses_every_mutation_of_an_owned_model():
    admin = AgentRunAdmin(AgentRun, None)

    assert admin.has_add_permission(None) is False
    assert admin.has_change_permission(None) is False
    assert admin.has_delete_permission(None) is False
    assert set(admin.get_readonly_fields(None)) == {
        field.name for field in AgentRun._meta.fields
    }


def test_the_guard_is_dormant_until_ownership_is_installed(monkeypatch):
    monkeypatch.delenv(RUST_OWNER_ENV, raising=False)

    assert rust_owns_runs_writes() is False
    assert runs_commands_ready() is False
    # A dormant guard must not raise: the pre-cutover build still runs.
    assert assert_django_runs_write_allowed("agent_runs") is None


def test_the_guard_fails_closed_for_non_http_writers_after_the_handoff(monkeypatch):
    monkeypatch.setenv(RUST_OWNER_ENV, "1")

    assert rust_owns_runs_writes() is True
    with pytest.raises(RuntimeError, match="django_slice3_write_disabled"):
        assert_django_runs_write_allowed("agent_runs")


def test_readiness_requires_the_exact_published_record(monkeypatch, tmp_path):
    import json

    monkeypatch.setenv(RUST_OWNER_ENV, "1")
    monkeypatch.setenv("MUXED_DATA_DIR", str(tmp_path))
    complete = {
        "version": 1,
        "runs_ownership": True,
        "effect_reconciliation": True,
        "graphql_status": True,
        "event_payload_version": 1,
        "compatibility_executor": True,
        "ready": True,
        "django_write_fallback": False,
    }

    assert runs_commands_ready() is False  # nothing published yet

    for field in ("runs_ownership", "effect_reconciliation", "compatibility_executor"):
        partial = {**complete, field: False, "ready": False}
        (tmp_path / "slice3-readiness.json").write_text(json.dumps(partial))
        assert runs_commands_ready() is False

    (tmp_path / "slice3-readiness.json").write_text(
        json.dumps({**complete, "unknown": True})
    )
    assert runs_commands_ready() is False

    (tmp_path / "slice3-readiness.json").write_text(json.dumps(complete))
    assert runs_commands_ready() is True


@pytest.mark.django_db
@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_legacy_http_mutations_of_an_owned_resource_are_refused(monkeypatch):
    monkeypatch.setenv(RUST_OWNER_ENV, "1")
    client = Client()

    refused = client.post("/api/automation-attempts/any-id/retry")

    assert refused.status_code == 410
    assert refused.json()["code"] == "django_slice3_write_disabled"
    # Reads stay open: unmigrated capabilities still consume the projections.
    readable = client.get(f"/api/runs/module-activity?project_id={uuid.uuid4()}")
    assert readable.status_code == 200
