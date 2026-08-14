"""Unit tests for the one atomic-replace primitive.

``studio_server.atomic_files`` is load-bearing for every hand-rolled
``mkstemp``/``os.replace`` site the backend used to carry, so the failure paths
— not just the happy one — are pinned here.
"""

from __future__ import annotations

import json
import os
import stat

import pytest

from studio_server.atomic_files import atomic_write_bytes, atomic_write_json


def _siblings(directory) -> list[str]:
    return sorted(child.name for child in directory.iterdir())


def test_creates_a_new_file(tmp_path):
    target = tmp_path / "fresh.json"

    atomic_write_json(target, {"a": 1})

    assert json.loads(target.read_text()) == {"a": 1}
    assert _siblings(tmp_path) == ["fresh.json"]


def test_replaces_existing_content(tmp_path):
    target = tmp_path / "existing.txt"
    target.write_bytes(b"old")

    atomic_write_bytes(target, b"new")

    assert target.read_bytes() == b"new"
    assert _siblings(tmp_path) == ["existing.txt"]


def test_failed_write_leaves_no_temp_sibling(tmp_path):
    target = tmp_path / "doc.json"

    with pytest.raises(TypeError):
        atomic_write_json(target, {"bad": object()})

    assert _siblings(tmp_path) == []


def test_failed_write_leaves_the_original_intact(tmp_path):
    target = tmp_path / "doc.json"
    target.write_text('{"keep": true}')

    with pytest.raises(TypeError):
        atomic_write_json(target, {"bad": object()})

    assert json.loads(target.read_text()) == {"keep": True}
    assert _siblings(tmp_path) == ["doc.json"]


def test_failed_byte_write_cleans_up_the_temp_sibling(tmp_path, monkeypatch):
    """A raise from inside the open handle still unlinks the candidate."""

    target = tmp_path / "doc.bin"
    target.write_bytes(b"original")

    real_replace = os.replace

    def exploding_replace(source, destination):
        raise OSError("rename refused")

    monkeypatch.setattr(os, "replace", exploding_replace)
    with pytest.raises(OSError):
        atomic_write_bytes(target, b"candidate")
    monkeypatch.setattr(os, "replace", real_replace)

    assert target.read_bytes() == b"original"
    assert _siblings(tmp_path) == ["doc.bin"]


def test_honors_an_explicit_mode(tmp_path):
    target = tmp_path / "secret"

    atomic_write_bytes(target, b"s3cret", mode=0o600)

    assert stat.S_IMODE(target.stat().st_mode) == 0o600


def test_fsync_does_not_change_observable_content(tmp_path):
    target = tmp_path / "manifest.json"

    atomic_write_json(
        target,
        {"b": 2, "a": 1},
        separators=(",", ":"),
        sort_keys=True,
        trailing_newline=True,
        mode=0o600,
        fsync=True,
    )

    assert target.read_text() == '{"a":1,"b":2}\n'


def test_json_formatting_arguments_are_passed_through(tmp_path):
    target = tmp_path / "profiles.json"

    atomic_write_json(target, {"profiles": []}, indent=4)

    assert target.read_text() == json.dumps({"profiles": []}, indent=4)
