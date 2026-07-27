from __future__ import annotations

import ast
from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[3]
APPS_ROOT = SERVER_ROOT / "apps"
TERMINALS_ROOT = APPS_ROOT / "terminals"


def _imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text())
    names = [
        node.module
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module is not None
    ]
    names.extend(
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    )
    return names


def _imports_tmux(path: Path) -> bool:
    return any(
        name == "apps.terminals.tmux" or name.startswith("apps.terminals.tmux.")
        for name in _imports(path)
    )


def test_non_terminal_apps_do_not_import_terminal_tmux():
    source_files = [
        path
        for path in APPS_ROOT.rglob("*.py")
        if "__pycache__" not in path.parts
        and TERMINALS_ROOT not in path.parents
    ]

    offenders = [path for path in source_files if _imports_tmux(path)]

    assert offenders == []


def test_terminal_edges_go_through_session_not_tmux():
    edges = [
        TERMINALS_ROOT / "consumers.py",
        TERMINALS_ROOT / "api.py",
    ]

    offenders = [path for path in edges if _imports_tmux(path)]

    assert offenders == []
