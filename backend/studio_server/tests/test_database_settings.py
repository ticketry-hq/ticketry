import pytest

from studio_server.database import (
    configured_database_url,
    default_database_settings,
    local_postgres_marker_file,
    postgres_database_settings,
)


def test_explicit_database_url_wins_over_shared_file(tmp_path, monkeypatch):
    shared = tmp_path / "database-url"
    shared.write_text("postgresql:///stored")
    monkeypatch.setenv("MUXED_DATABASE_URL_FILE", str(shared))
    monkeypatch.setenv("MUXED_DATABASE_URL", "postgresql:///explicit")
    monkeypatch.setenv("MUXED_ENABLE_LOCAL_POSTGRES", "true")

    assert configured_database_url() == "postgresql:///explicit"


def test_force_sqlite_wins_over_development_and_explicit_postgres(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("MUXED_FORCE_SQLITE", "true")
    monkeypatch.setenv("MUXED_ENABLE_LOCAL_POSTGRES", "true")
    monkeypatch.setenv("MUXED_DATABASE_URL", "postgresql:///explicit")
    monkeypatch.setenv("MUXED_DATABASE_URL_FILE", str(tmp_path / "database-url"))

    assert configured_database_url() is None


def test_shared_database_url_is_used_without_an_environment_override(
    tmp_path, monkeypatch
):
    shared = tmp_path / "database-url"
    shared.write_text("postgresql:///ticketry\n")
    monkeypatch.setenv("MUXED_DATABASE_URL_FILE", str(shared))
    monkeypatch.delenv("MUXED_DATABASE_URL", raising=False)
    monkeypatch.setenv("MUXED_ENABLE_LOCAL_POSTGRES", "true")

    assert configured_database_url() == "postgresql:///ticketry"


def test_postgres_url_is_translated_without_losing_connection_options():
    settings = postgres_database_settings(
        "postgresql://ticketry:p%40ss@localhost:5433/ticketry?sslmode=disable"
    )

    assert settings == {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "ticketry",
        "USER": "ticketry",
        "PASSWORD": "p@ss",
        "HOST": "localhost",
        "PORT": 5433,
        "CONN_MAX_AGE": 0,
        "OPTIONS": {"sslmode": "disable"},
    }


def test_sqlite_remains_the_default_when_shared_file_is_absent(tmp_path, monkeypatch):
    monkeypatch.delenv("MUXED_DATABASE_URL", raising=False)
    monkeypatch.setenv("MUXED_DATABASE_URL_FILE", str(tmp_path / "missing"))
    sqlite_path = tmp_path / "state.db"

    settings = default_database_settings(sqlite_path)

    assert settings["ENGINE"] == "django.db.backends.sqlite3"
    assert settings["NAME"] == sqlite_path


def test_distributed_runtime_ignores_local_postgres_without_dev_gate(
    tmp_path, monkeypatch
):
    shared = tmp_path / "database-url"
    shared.write_text("postgresql:///ticketry")
    monkeypatch.setenv("MUXED_DATABASE_URL_FILE", str(shared))
    monkeypatch.setenv("MUXED_DATABASE_URL", "postgresql:///explicit")
    monkeypatch.delenv("MUXED_ENABLE_LOCAL_POSTGRES", raising=False)

    sqlite_path = tmp_path / "distributed-state.db"
    settings = default_database_settings(sqlite_path)

    assert settings["ENGINE"] == "django.db.backends.sqlite3"
    assert settings["NAME"] == sqlite_path


def test_this_users_installed_runtime_uses_postgres_marker(tmp_path, monkeypatch):
    shared = tmp_path / "database-url"
    shared.write_text("postgresql:///ticketry")
    monkeypatch.setenv("MUXED_DATABASE_URL_FILE", str(shared))
    monkeypatch.delenv("MUXED_DATABASE_URL", raising=False)
    monkeypatch.delenv("MUXED_ENABLE_LOCAL_POSTGRES", raising=False)
    local_postgres_marker_file().write_text("enabled\n")

    settings = default_database_settings(tmp_path / "installed-state.db")

    assert settings["ENGINE"] == "django.db.backends.postgresql"
    assert settings["NAME"] == "ticketry"


@pytest.mark.parametrize("url", ["mysql://localhost/ticketry", "postgresql://localhost"])
def test_invalid_shared_database_urls_fail_closed(url):
    with pytest.raises(ValueError):
        postgres_database_settings(url)
