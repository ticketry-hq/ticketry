"""One-time migration of Studio's machine-local config and path-bearing state."""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from pathlib import Path


LEGACY_CONFIG_DIR = Path.home() / ".config" / "plane-tui"
# The packaged sidecar supplies this before Django imports settings.  Keeping
# the default preserves the browser/development runtime's established state
# location while allowing the desktop supervisor to own its data directory.
CONFIG_DIR = Path(
    os.environ.get("MUXED_DATA_DIR", Path.home() / ".config" / "worktracker-studio")
).expanduser()
_REPOSITORY_PARENT = Path(__file__).resolve().parents[4]
LEGACY_CHECKOUT_ROOT = _REPOSITORY_PARENT / "plane-tui"
CHECKOUT_ROOT = _REPOSITORY_PARENT / "muxed"


class ConfigMigrationConflict(RuntimeError):
    """Local state cannot be migrated without an explicit operator choice."""


def _exists_including_symlink(path: Path) -> bool:
    return os.path.lexists(path)


def _rewrite_path(value: str, old_root: str, new_root: str) -> str:
    if value == old_root or value.startswith(old_root + "/"):
        return new_root + value[len(old_root) :]
    return value


def _rewrite_nested_paths(value, old_root: str, new_root: str):
    if isinstance(value, str):
        return _rewrite_path(value, old_root, new_root)
    if isinstance(value, list):
        return [_rewrite_nested_paths(item, old_root, new_root) for item in value]
    if isinstance(value, dict):
        return {
            key: _rewrite_nested_paths(item, old_root, new_root)
            for key, item in value.items()
        }
    return value


def _atomic_write_json(path: Path, value) -> None:
    payload = json.dumps(value, indent=4)
    fd, tmp_path = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=str(path.parent)
    )
    tmp = Path(tmp_path)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(payload)
        os.replace(tmp, path)
    except Exception:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
        raise


def _rewrite_profiles(path: Path, old_root: str, new_root: str) -> None:
    if not path.exists():
        return
    data = json.loads(path.read_text())
    changed = False
    for profile in data.get("profiles", []):
        folders = profile.get("module_folders")
        if not isinstance(folders, dict):
            continue
        rewritten = {
            key: _rewrite_path(value, old_root, new_root)
            if isinstance(value, str)
            else value
            for key, value in folders.items()
        }
        if rewritten != folders:
            profile["module_folders"] = rewritten
            changed = True
    if changed:
        _atomic_write_json(path, data)


_PATH_COLUMNS = {
    "agent_runs": ("cwd", "design_dir"),
    "design_documents": ("root_dir",),
    "worktrees": ("repo_root", "path"),
    "orchestrator_headless_runs": ("cwd",),
}


def _table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {
        row[1]
        for row in connection.execute(f'PRAGMA table_info("{table}")').fetchall()
    }


def _rewrite_column(
    connection: sqlite3.Connection,
    table: str,
    column: str,
    old_root: str,
    new_root: str,
) -> None:
    connection.execute(
        f'''UPDATE "{table}"
            SET "{column}" = ? || substr("{column}", ?)
            WHERE "{column}" = ?
               OR substr("{column}", 1, ?) = ?''',
        (new_root, len(old_root) + 1, old_root, len(old_root) + 1, old_root + "/"),
    )


def _rewrite_app_settings(
    connection: sqlite3.Connection, old_root: str, new_root: str
) -> None:
    if not {"scope", "key", "value"}.issubset(
        _table_columns(connection, "app_settings")
    ):
        return
    rows = connection.execute(
        "SELECT scope, key, value FROM app_settings"
    ).fetchall()
    for scope, key, raw_value in rows:
        if not isinstance(raw_value, str):
            continue
        try:
            decoded = json.loads(raw_value)
        except (json.JSONDecodeError, TypeError):
            rewritten = _rewrite_path(raw_value, old_root, new_root)
        else:
            migrated = _rewrite_nested_paths(decoded, old_root, new_root)
            rewritten = json.dumps(migrated) if migrated != decoded else raw_value
        if rewritten != raw_value:
            connection.execute(
                "UPDATE app_settings SET value = ? WHERE scope = ? AND key = ?",
                (rewritten, scope, key),
            )


def _rewrite_state_db(path: Path, old_root: str, new_root: str) -> None:
    if not path.exists():
        return
    connection = sqlite3.connect(path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        for table, columns in _PATH_COLUMNS.items():
            existing_columns = _table_columns(connection, table)
            for column in columns:
                if column in existing_columns:
                    _rewrite_column(connection, table, column, old_root, new_root)
        _rewrite_app_settings(connection, old_root, new_root)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def migrate_local_state(
    *,
    legacy_config_dir: Path = LEGACY_CONFIG_DIR,
    config_dir: Path = CONFIG_DIR,
    old_checkout_root: str | Path = LEGACY_CHECKOUT_ROOT,
    new_checkout_root: str | Path = CHECKOUT_ROOT,
) -> None:
    """Move local state once and rewrite checkout-rooted paths in place."""

    legacy_exists = _exists_including_symlink(legacy_config_dir)
    current_exists = _exists_including_symlink(config_dir)
    if legacy_exists and current_exists:
        raise ConfigMigrationConflict(
            "Both legacy and current config directories exist: "
            f"{legacy_config_dir} and {config_dir}. "
            "Stop Studio, inspect both directories. Remove or back up one; "
            "the migration will never merge or overwrite them."
        )
    if legacy_exists:
        if legacy_config_dir.is_symlink() or not legacy_config_dir.is_dir():
            raise ConfigMigrationConflict(
                f"Legacy config path must be a real directory, not an alias: {legacy_config_dir}"
            )
        config_dir.parent.mkdir(parents=True, exist_ok=True)
        legacy_config_dir.rename(config_dir)
        current_exists = True
    if not current_exists:
        return
    if config_dir.is_symlink() or not config_dir.is_dir():
        raise ConfigMigrationConflict(
            f"Current config path must be a real directory, not an alias: {config_dir}"
        )

    old_root = str(old_checkout_root).rstrip("/")
    new_root = str(new_checkout_root).rstrip("/")
    _rewrite_profiles(config_dir / "profiles.json", old_root, new_root)
    _rewrite_state_db(config_dir / "state.db", old_root, new_root)
