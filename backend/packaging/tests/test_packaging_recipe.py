"""Contracts for the PyInstaller sidecar data manifest."""

from __future__ import annotations

import json
import runpy
import sys
import types
from pathlib import Path

import pytest


PACKAGING_DIR = Path(__file__).resolve().parents[1]
SPEC_PATH = PACKAGING_DIR / "muxed-backend.spec"
REPOSITORY_ROOT = PACKAGING_DIR.parents[1]


def _execute_spec(monkeypatch, *, package_datas=()):
    hooks = types.ModuleType("PyInstaller.utils.hooks")
    hooks.collect_all = lambda _package: (list(package_datas), [], [])
    hooks.copy_metadata = lambda _package: []
    utils = types.ModuleType("PyInstaller.utils")
    pyinstaller = types.ModuleType("PyInstaller")

    monkeypatch.setitem(sys.modules, "PyInstaller", pyinstaller)
    monkeypatch.setitem(sys.modules, "PyInstaller.utils", utils)
    monkeypatch.setitem(sys.modules, "PyInstaller.utils.hooks", hooks)
    monkeypatch.setenv("MUXED_SIDECAR_NAME", "muxed-backend-test")

    captured = {}

    class Analysis:
        def __init__(
            self, _scripts, *, binaries, datas, hiddenimports, pathex, **_kwargs
        ):
            self.scripts = []
            self.pure = []
            self.binaries = binaries
            self.datas = datas
            captured["datas"] = list(datas)
            captured["hiddenimports"] = list(hiddenimports)
            captured["pathex"] = list(pathex)

    class PYZ:
        def __init__(self, _pure):
            pass

    class EXE:
        def __init__(self, *_args, **_kwargs):
            pass

    runpy.run_path(
        str(SPEC_PATH),
        init_globals={
            "SPECPATH": str(PACKAGING_DIR),
            "Analysis": Analysis,
            "PYZ": PYZ,
            "EXE": EXE,
        },
    )
    return captured


def test_reviewed_defaults_are_an_explicit_direct_sidecar_input(monkeypatch):
    datas = _execute_spec(monkeypatch)["datas"]
    explicit_entries = [
        (Path(source).resolve(), destination)
        for source, destination in datas
        if Path(source).name == "reviewed_defaults.json"
    ]

    release_manifest_path = REPOSITORY_ROOT / "studio" / "release" / "manifest.v1.json"
    release_manifest = json.loads(release_manifest_path.read_text(encoding="utf-8"))
    validated_artifact = (
        release_manifest_path.parent.parent
        / release_manifest["artifacts"]["sidecar"]["defaults_artifact"]
    ).resolve()

    assert explicit_entries == [(validated_artifact, "worktracker")]


def test_sidecar_packaging_rejects_database_artifacts_in_any_form(monkeypatch):
    database_paths = [
        "/tmp/state.db",
        "/tmp/state.db-wal",
        "/tmp/state.db-shm",
        "/tmp/state.db.pre-migration.1",
        "/tmp/state.sqlite",
        "/tmp/state.sqlite3",
    ]

    with pytest.raises(ValueError, match="must not contain database artifacts") as error:
        _execute_spec(
            monkeypatch,
            package_datas=[(database_path, "worktracker") for database_path in database_paths],
        )

    for database_path in database_paths:
        assert database_path in str(error.value)


def test_sidecar_packaging_includes_owner_liveness_module(monkeypatch):
    manifest = _execute_spec(monkeypatch)

    assert "owner_liveness" in manifest["hiddenimports"]
    assert str(PACKAGING_DIR) in manifest["pathex"]
