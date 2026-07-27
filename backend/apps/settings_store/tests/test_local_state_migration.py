"""One-time local state migration preserves and rewrites the whole store."""

from __future__ import annotations

import json
import sqlite3

import pytest

from apps.settings_store.config import ConfigMigrationConflict, migrate_local_state


OLD_ROOT = "/workspace/plane-tui"
NEW_ROOT = "/workspace/muxed"


def _migrate(tmp_path):
    legacy = tmp_path / "plane-tui"
    current = tmp_path / "worktracker-studio"
    migrate_local_state(
        legacy_config_dir=legacy,
        config_dir=current,
        old_checkout_root=OLD_ROOT,
        new_checkout_root=NEW_ROOT,
    )
    return legacy, current


def _write_profiles(config_dir):
    config_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "profiles.json").write_text(
        json.dumps(
            {
                "recent_profile_index": 0,
                "profiles": [
                    {
                        "name": "local",
                        "workspace_slug": "meml",
                        "module_folders": {
                            "root": OLD_ROOT,
                            "nested": f"{OLD_ROOT}/server",
                            "trailing": f"{OLD_ROOT}/",
                            "already-new": NEW_ROOT,
                            "similar": f"{OLD_ROOT}-archive",
                        },
                    }
                ],
            }
        )
    )


def test_legacy_only_moves_whole_directory_and_rewrites_profiles(tmp_path):
    legacy = tmp_path / "plane-tui"
    _write_profiles(legacy)
    (legacy / "state.db-wal").write_text("wal")
    (legacy / "worktracker_token").write_text("token")
    (legacy / "media").mkdir()
    (legacy / "media" / "artifact.txt").write_text("media")

    legacy, current = _migrate(tmp_path)

    assert not legacy.exists()
    assert (current / "state.db-wal").read_text() == "wal"
    assert (current / "worktracker_token").read_text() == "token"
    assert (current / "media" / "artifact.txt").read_text() == "media"
    folders = json.loads((current / "profiles.json").read_text())["profiles"][0][
        "module_folders"
    ]
    assert folders == {
        "root": NEW_ROOT,
        "nested": f"{NEW_ROOT}/server",
        "trailing": f"{NEW_ROOT}/",
        "already-new": NEW_ROOT,
        "similar": f"{OLD_ROOT}-archive",
    }


def test_new_only_rewrites_in_place_and_is_idempotent(tmp_path):
    current = tmp_path / "worktracker-studio"
    _write_profiles(current)

    _migrate(tmp_path)
    first = (current / "profiles.json").read_text()
    _migrate(tmp_path)

    assert (current / "profiles.json").read_text() == first


def test_neither_directory_is_a_noop(tmp_path):
    legacy, current = _migrate(tmp_path)

    assert not legacy.exists()
    assert not current.exists()


def test_both_directories_fail_without_touching_either(tmp_path):
    legacy = tmp_path / "plane-tui"
    current = tmp_path / "worktracker-studio"
    legacy.mkdir()
    current.mkdir()
    (legacy / "marker").write_text("legacy")
    (current / "marker").write_text("current")

    with pytest.raises(ConfigMigrationConflict, match="Remove or back up one"):
        _migrate(tmp_path)

    assert (legacy / "marker").read_text() == "legacy"
    assert (current / "marker").read_text() == "current"


def _create_populated_state_db(path):
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE agent_runs (id TEXT PRIMARY KEY, cwd TEXT, design_dir TEXT);
        CREATE TABLE design_documents (id TEXT PRIMARY KEY, root_dir TEXT);
        CREATE TABLE worktrees (id TEXT PRIMARY KEY, repo_root TEXT, path TEXT);
        CREATE TABLE orchestrator_headless_runs (id TEXT PRIMARY KEY, cwd TEXT);
        CREATE TABLE app_settings (
            scope TEXT,
            key TEXT,
            value TEXT,
            PRIMARY KEY (scope, key)
        );
        """
    )
    connection.execute(
        "INSERT INTO agent_runs VALUES (?, ?, ?)",
        ("run", OLD_ROOT, f"{OLD_ROOT}/spec/ticket"),
    )
    connection.execute(
        "INSERT INTO design_documents VALUES (?, ?)",
        ("doc", f"{OLD_ROOT}/spec"),
    )
    connection.execute(
        "INSERT INTO worktrees VALUES (?, ?, ?)",
        ("tree", OLD_ROOT, f"{OLD_ROOT}/.worktrees/one"),
    )
    connection.execute(
        "INSERT INTO orchestrator_headless_runs VALUES (?, ?)",
        ("headless", f"{OLD_ROOT}/server"),
    )
    connection.executemany(
        "INSERT INTO app_settings VALUES (?, ?, ?)",
        [
            ("global", "plain", f"{OLD_ROOT}/cache"),
            (
                "global",
                "json",
                json.dumps(
                    {
                        "root": OLD_ROOT,
                        "nested": [f"{OLD_ROOT}/server", "unchanged"],
                        "prose": f"checkout is at {OLD_ROOT}",
                    }
                ),
            ),
        ],
    )
    connection.commit()
    return connection


def test_populated_sqlite_stores_are_rewritten(tmp_path):
    current = tmp_path / "worktracker-studio"
    current.mkdir()
    connection = _create_populated_state_db(current / "state.db")
    connection.close()

    _migrate(tmp_path)

    connection = sqlite3.connect(current / "state.db")
    assert connection.execute("SELECT cwd, design_dir FROM agent_runs").fetchone() == (
        NEW_ROOT,
        f"{NEW_ROOT}/spec/ticket",
    )
    assert connection.execute("SELECT root_dir FROM design_documents").fetchone() == (
        f"{NEW_ROOT}/spec",
    )
    assert connection.execute("SELECT repo_root, path FROM worktrees").fetchone() == (
        NEW_ROOT,
        f"{NEW_ROOT}/.worktrees/one",
    )
    assert connection.execute(
        "SELECT cwd FROM orchestrator_headless_runs"
    ).fetchone() == (f"{NEW_ROOT}/server",)
    values = dict(connection.execute("SELECT key, value FROM app_settings"))
    assert values["plain"] == f"{NEW_ROOT}/cache"
    assert json.loads(values["json"]) == {
        "root": NEW_ROOT,
        "nested": [f"{NEW_ROOT}/server", "unchanged"],
        "prose": f"checkout is at {OLD_ROOT}",
    }
    connection.close()


def test_sqlite_path_rewrite_is_transactional(tmp_path):
    current = tmp_path / "worktracker-studio"
    current.mkdir()
    connection = _create_populated_state_db(current / "state.db")
    connection.execute(
        """
        CREATE TRIGGER reject_document_rewrite
        BEFORE UPDATE ON design_documents
        BEGIN
            SELECT RAISE(ABORT, 'simulated rewrite failure');
        END
        """
    )
    connection.commit()
    connection.close()

    with pytest.raises(sqlite3.IntegrityError, match="simulated rewrite failure"):
        _migrate(tmp_path)

    connection = sqlite3.connect(current / "state.db")
    assert connection.execute("SELECT cwd FROM agent_runs").fetchone() == (OLD_ROOT,)
    assert connection.execute("SELECT root_dir FROM design_documents").fetchone() == (
        f"{OLD_ROOT}/spec",
    )
    connection.close()
