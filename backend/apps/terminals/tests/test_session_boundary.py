"""Static dependency gates for the public terminal-runtime boundary."""

from __future__ import annotations

import ast
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[3]
APPS_ROOT = BACKEND_ROOT / "apps"
TERMINALS_ROOT = APPS_ROOT / "terminals"
RUNTIME_ROOT = TERMINALS_ROOT / "runtime"
TMUX_ROOT = TERMINALS_ROOT / "tmux"
RUST_ROOT = BACKEND_ROOT.parent / "studio" / "src-tauri" / "src"


def _production_sources(root: Path):
    return (
        path
        for path in root.rglob("*.py")
        if "tests" not in path.parts
        and "migrations" not in path.parts
        and ".venv" not in path.parts
        and "__pycache__" not in path.parts
    )


def _imports(path: Path) -> list[tuple[str, int]]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    imports: list[tuple[str, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend((alias.name, node.lineno) for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.append((node.module, node.lineno))
    return imports


def _matches(name: str, prefixes: tuple[str, ...]) -> bool:
    return any(name == prefix or name.startswith(f"{prefix}.") for prefix in prefixes)


def test_runtime_contains_mechanics_only():
    forbidden = (
        "django",
        "apps.documents",
        "apps.runs",
        "apps.settings_store",
        "apps.terminals.agents",
        "apps.terminals.launch",
        "apps.terminals.launch_configuration",
        "apps.terminals.models",
        "apps.terminals.persistence",
        "apps.terminals.prompt_builder",
        "apps.terminals.reconciliation",
        "apps.terminals.viewer_attachments",
        "apps.terminals.viewer_leases",
        "worktracker",
    )
    offenders = [
        f"{path.relative_to(BACKEND_ROOT)}:{line}:{name}"
        for path in _production_sources(RUNTIME_ROOT)
        for name, line in _imports(path)
        if _matches(name, forbidden)
    ]
    assert offenders == []


def test_application_callers_cannot_reach_private_terminal_implementation():
    forbidden = (
        "apps.terminals.session",
        "apps.terminals.session_registry",
        "apps.terminals.tmux",
        "apps.terminals.runtime._contract",
        "apps.terminals.runtime._fake",
        "apps.terminals.runtime._tmux",
        "libtmux",
        "pty",
        "ptyprocess",
    )
    allowed_roots = (RUNTIME_ROOT, TMUX_ROOT)
    offenders = [
        f"{path.relative_to(BACKEND_ROOT)}:{line}:{name}"
        for path in _production_sources(BACKEND_ROOT)
        if not any(path == root or root in path.parents for root in allowed_roots)
        for name, line in _imports(path)
        if _matches(name, forbidden)
    ]
    assert offenders == []


def test_native_callers_cannot_reach_private_terminal_implementation():
    allowed = {"terminal_runtime.rs", "tmux_viewer.rs"}
    offenders = [
        str(path.relative_to(BACKEND_ROOT.parent))
        for path in RUST_ROOT.glob("*.rs")
        if path.name not in allowed
        and "crate::tmux_viewer" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []


def test_legacy_session_facade_is_removed():
    assert not (TERMINALS_ROOT / "session.py").exists()
    assert not (TERMINALS_ROOT / "session_registry.py").exists()
