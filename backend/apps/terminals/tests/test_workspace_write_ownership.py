"""One-writer guard: the terminal capability cannot reach Rust-owned tables.

After the Slice 4 handoff, `design_documents` and `worktrees` have exactly one
production writer, and it is not Django. The terminal capability is the last
Python code that still needs anything from either — it launches agents into
worktrees and design directories — so it is the one place a backdoor would
plausibly reappear.

The refusal is structural rather than a promise: the terminal package may not
import the ORM models, the DAOs, or the services that write those tables, and
the compatibility port it *does* use exposes no verb that could.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from apps.terminals import launch_paths_port


TERMINALS = Path(__file__).resolve().parent.parent

#: Modules that read or write the tables Rust now owns. None of them may be
#: imported by shipping terminal code.
RUST_OWNED_MODULES = (
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

#: Nothing. Every seam is closed: the Rust watcher supervisor took over live
#: document discovery, so the terminal capability no longer starts or stops a
#: Python watcher, and the design directory it launches into still comes from
#: the read-only compatibility port.
PENDING_DISCOVERY_SEAM: set[str] = set()


def _shipping_modules() -> list[Path]:
    return [
        path
        for path in sorted(TERMINALS.rglob("*.py"))
        if "tests" not in path.parts and "__pycache__" not in path.parts
    ]


def _imported_modules(source: str) -> set[str]:
    """Every module name a file imports, in dotted form."""

    imported: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            imported.add(node.module)
            imported.update(f"{node.module}.{alias.name}" for alias in node.names)
    return imported


def test_no_terminal_module_imports_a_rust_owned_table():
    offenders: list[str] = []
    for path in _shipping_modules():
        imported = _imported_modules(path.read_text()) - PENDING_DISCOVERY_SEAM
        for owned in RUST_OWNED_MODULES:
            if any(name == owned or name.startswith(f"{owned}.") for name in imported):
                offenders.append(f"{path.relative_to(TERMINALS)} -> {owned}")

    assert offenders == [], (
        "terminal code must reach Documents and Worktrees only through "
        f"apps.terminals.launch_paths_port: {offenders}"
    )


def test_the_terminal_package_declares_no_model_or_sql_for_an_owned_table():
    """Imports are not the only backdoor: a model or raw statement is one too."""

    offenders: list[str] = []
    for path in _shipping_modules():
        source = path.read_text().lower()
        for table in ("design_documents", "worktrees"):
            statements = (
                f'db_table = "{table}"',
                f"db_table = '{table}'",
                f"insert into {table}",
                f"update {table}",
                f"delete from {table}",
                f"from {table}",
            )
            if any(statement in source for statement in statements):
                offenders.append(f"{path.relative_to(TERMINALS)} -> {table}")

    assert offenders == [], (
        f"terminal code declares a Django write surface for a Rust-owned table: {offenders}"
    )


def test_the_compatibility_port_exposes_no_effect_verb():
    """The boundary resolves. It cannot be asked to change anything."""

    public = {
        name
        for name in dir(launch_paths_port)
        if not name.startswith("_") and callable(getattr(launch_paths_port, name))
    }

    assert "resolve" in public
    for verb in ("create", "save", "prune", "discard", "integrate", "delete", "write"):
        assert not any(verb in name.lower() for name in public), (
            f"the compatibility port exposes a `{verb}` verb: {public}"
        )


@pytest.mark.parametrize(
    "forbidden",
    ["path", "cwd", "root_dir", "repo_root", "branch", "content", "rel_path"],
)
def test_the_port_signature_accepts_no_place_or_body(forbidden):
    import inspect

    parameters = set(inspect.signature(launch_paths_port.resolve).parameters)

    assert forbidden not in parameters
