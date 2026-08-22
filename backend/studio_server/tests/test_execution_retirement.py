"""Cutover contract for the retired Django execution authority."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / "backend"
EXECUTION_APP = BACKEND / "apps" / "execution"


def test_shipping_python_has_no_execution_authority() -> None:
    shipping_modules = sorted(
        path.relative_to(EXECUTION_APP).as_posix()
        for path in EXECUTION_APP.glob("*.py")
        if path.name != "__init__.py"
    )

    assert shipping_modules == []


def test_django_does_not_install_or_route_execution() -> None:
    settings = (BACKEND / "studio_server" / "settings.py").read_text()
    urls = (BACKEND / "apps" / "rest_urls.py").read_text()
    api = (BACKEND / "apps" / "rest_api.py").read_text()

    assert '"apps.execution"' not in settings
    assert "GraphRunView" not in api
    assert "LaunchAgentView" not in api
    assert "RunNowView" not in api
    assert "graph-run" not in urls
    assert "launch-agent" not in urls
    assert "run-now" not in urls


def test_packaged_sidecar_excludes_the_execution_package() -> None:
    recipe = (BACKEND / "packaging" / "muxed-backend.spec").read_text()

    assert '"apps.execution"' in recipe


def test_legacy_execution_migration_history_is_preserved() -> None:
    migrations = sorted(
        path.name
        for path in (EXECUTION_APP / "migrations").glob("[0-9]*.py")
    )

    assert migrations == [
        "0001_initial.py",
        "0002_graphrun.py",
        "0003_nullable_agent_override.py",
        "0004_remove_enginerun_phase.py",
        "0005_launchedtask_delete_enginerun.py",
        "0006_graphrun_execution_mode.py",
        "0007_graph_run_launch_configuration.py",
    ]


def test_current_catalog_uses_launch_claim_terminology() -> None:
    current_docs = [
        ROOT / "docs" / "modelcatalog" / "components" / "DataModel.astro",
        ROOT
        / "docs"
        / "eventcatalog"
        / "domains"
        / "agent-execution"
        / "systems"
        / "agent-execution-system"
        / "services"
        / "execution-engine"
        / "index.mdx",
        ROOT
        / "studio"
        / "src-tauri"
        / "src"
        / "graph_run_service"
        / "CONTEXT.md",
    ]

    sources = "\n".join(path.read_text() for path in current_docs)
    assert "Engine" + "Run" not in sources
    assert "LaunchedTask" in sources
    assert "direct children" in sources
