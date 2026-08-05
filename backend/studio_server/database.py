"""Database configuration shared by development and packaged runtimes."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit


DEFAULT_DATABASE_URL_FILE = (
    Path.home() / ".config" / "worktracker-studio" / "database-url"
)


def database_url_file() -> Path:
    """Return the user-level opt-in file shared by every local checkout."""

    configured = os.environ.get("MUXED_DATABASE_URL_FILE")
    return Path(configured).expanduser() if configured else DEFAULT_DATABASE_URL_FILE


def local_postgres_marker_file() -> Path:
    """Return the machine-local marker that opts installed Ticketry into Postgres."""

    return database_url_file().with_name(f"{database_url_file().name}.enabled")


def configured_database_url() -> str | None:
    """Resolve Postgres for source development or this user's opted-in install."""

    force_sqlite = os.environ.get("MUXED_FORCE_SQLITE", "").lower()
    if force_sqlite in {"1", "true", "yes"}:
        return None

    enabled = os.environ.get("MUXED_ENABLE_LOCAL_POSTGRES", "").lower()
    development_enabled = enabled in {"1", "true", "yes"}
    if not development_enabled and not local_postgres_marker_file().is_file():
        return None

    explicit = os.environ.get("MUXED_DATABASE_URL")
    if explicit:
        return explicit.strip()

    try:
        stored = database_url_file().read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return None
    return stored or None


def postgres_database_settings(url: str) -> dict[str, object]:
    """Translate a PostgreSQL URL into Django's native database settings."""

    parsed = urlsplit(url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError(
            "MUXED_DATABASE_URL must use the postgres:// or postgresql:// scheme"
        )
    if not parsed.path or parsed.path == "/":
        raise ValueError("MUXED_DATABASE_URL must name a database")
    if parsed.fragment:
        raise ValueError("MUXED_DATABASE_URL must not contain a fragment")

    settings: dict[str, object] = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": unquote(parsed.path.removeprefix("/")),
        "CONN_MAX_AGE": 0,
    }
    if parsed.username is not None:
        settings["USER"] = unquote(parsed.username)
    if parsed.password is not None:
        settings["PASSWORD"] = unquote(parsed.password)
    if parsed.hostname is not None:
        settings["HOST"] = parsed.hostname
    if parsed.port is not None:
        settings["PORT"] = parsed.port

    options = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if options:
        settings["OPTIONS"] = options
    return settings


def default_database_settings(sqlite_path: Path) -> dict[str, object]:
    """Use opted-in local Postgres; other users' installs stay on SQLite."""

    database_url = configured_database_url()
    if database_url:
        return postgres_database_settings(database_url)
    return {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": sqlite_path,
        "CONN_MAX_AGE": 0,
        "OPTIONS": {
            "init_command": (
                "PRAGMA journal_mode=WAL; "
                "PRAGMA busy_timeout=5000; "
                "PRAGMA foreign_keys=ON;"
            ),
        },
    }
