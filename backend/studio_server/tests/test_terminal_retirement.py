"""Structural gate for the Rust-only terminal production boundary."""

from __future__ import annotations

import ast
from pathlib import Path

from django.urls import get_resolver

from studio_server import asgi, routing


BACKEND = Path(__file__).resolve().parents[2]
RETIRED_ROUTE_PARTS = (
    "terminals",
    "lifecycle/events",
    "launch-policy-effects",
)
STARTUP_FORBIDDEN = (
    "apps.terminals",
    "hook_spool",
    "transition_occurrence_scheduler",
    "reconcile_terminals",
    "MUXED_IDLE_SWEEP_MINUTES",
)
RETIRED_TERMINAL_MODULES = (
    "api.py",
    "consumers.py",
    "control_plane.py",
    "durable_launch.py",
    "frames.py",
    "launch.py",
    "persistence.py",
    "reconciliation.py",
    "reconciliation_scheduler.py",
    "runs_effect_port.py",
    "shell_api.py",
    "shell_launch.py",
    "termination_seam.py",
    "viewer_attachments.py",
    "viewer_leases.py",
)
RUST_OWNED_WORKSPACE_MODULES = (
    "apps.worktrees.models",
    "apps.worktrees.dao",
    "apps.worktrees.service",
    "apps.worktrees.signals",
    "apps.worktrees.api",
    "apps.documents.models",
    "apps.documents.dao",
    "apps.documents.service",
    "apps.documents.design_docs",
    "apps.documents.api",
)


def _shipping_terminal_modules():
    return [
        path
        for path in sorted((BACKEND / "apps" / "terminals").rglob("*.py"))
        if "tests" not in path.parts
        and "migrations" not in path.parts
        and "__pycache__" not in path.parts
    ]


def _imported_modules(source):
    imported = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            imported.add(node.module)
            imported.update(f"{node.module}.{alias.name}" for alias in node.names)
    return imported


def _routes(patterns=None, prefix=""):
    patterns = get_resolver().url_patterns if patterns is None else patterns
    rendered = []
    for pattern in patterns:
        path = prefix + str(pattern.pattern)
        if hasattr(pattern, "url_patterns"):
            rendered.extend(_routes(pattern.url_patterns, path))
        else:
            rendered.append(path)
    return rendered


def test_shipping_http_and_websocket_routes_have_no_python_terminal_surface():
    rendered = "\n".join(_routes())

    assert not any(part in rendered for part in RETIRED_ROUTE_PARTS)
    assert routing.websocket_urlpatterns == []


def test_django_startup_registers_no_terminal_or_launch_background_work():
    source = (BACKEND / "studio_server" / "asgi.py").read_text(encoding="utf-8")

    assert asgi.startup_callables == []
    assert asgi.shutdown_callables == []
    assert not any(token in source for token in STARTUP_FORBIDDEN)


def test_sidecar_entrypoint_has_no_terminal_fallback_commands():
    source = (BACKEND / "packaging" / "sidecar.py").read_text(encoding="utf-8")
    main_source = source[source.index("def main(") :]

    assert 'argv[:1] == ["hook"]' not in main_source
    assert 'argv[:1] == ["skills"]' not in main_source
    assert "prepare_provider_skills()" not in main_source
    assert "MUXED_LIFECYCLE_URL" not in source
    assert "MUXED_HOOK_SPOOL_DIR" not in source


def test_terminal_models_are_migration_history_only():
    settings_source = (BACKEND / "studio_server" / "settings.py").read_text(
        encoding="utf-8"
    )
    routes_source = (BACKEND / "apps" / "rest_urls.py").read_text(encoding="utf-8")
    registry_source = (BACKEND / "worktracker" / "registry.py").read_text(
        encoding="utf-8"
    )

    assert '"apps.terminals"' not in settings_source
    assert not (BACKEND / "apps" / "terminals" / "admin.py").exists()
    assert "terminals/" not in routes_source
    assert "/api/terminals" not in registry_source
    assert "/api/lifecycle/events" not in registry_source


def test_replaced_terminal_authority_is_removed_from_python_source():
    remaining = [
        name
        for name in RETIRED_TERMINAL_MODULES
        if (BACKEND / "apps" / "terminals" / name).exists()
    ]
    remaining_output_modules = sorted(
        path.name
        for path in (BACKEND / "apps" / "terminals" / "output_activity").glob("*.py")
    )

    assert remaining == []
    assert remaining_output_modules == []


def test_django_in_memory_run_status_bus_is_removed():
    assert not (BACKEND / "apps" / "runs" / "bus.py").exists()


def test_surviving_terminal_helpers_do_not_reach_rust_owned_workspace_tables():
    offenders = []
    for path in _shipping_terminal_modules():
        imported = _imported_modules(path.read_text(encoding="utf-8"))
        for owned in RUST_OWNED_WORKSPACE_MODULES:
            if any(name == owned or name.startswith(f"{owned}.") for name in imported):
                offenders.append(
                    f"{path.relative_to(BACKEND / 'apps' / 'terminals')} -> {owned}"
                )

    assert offenders == []


def test_surviving_terminal_helpers_declare_no_owned_workspace_sql_or_models():
    offenders = []
    for path in _shipping_terminal_modules():
        source = path.read_text(encoding="utf-8").lower()
        for table in ("design_documents", "worktrees"):
            statements = (
                f'db_table = "{table}"',
                f"db_table = '{table}'",
                f"insert into {table}",
                f"update {table}",
                f"delete from {table}",
            )
            if any(statement in source for statement in statements):
                offenders.append(f"{path.name} -> {table}")

    assert offenders == []
