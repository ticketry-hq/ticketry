"""Contract checks for the packaged backend entry point."""

from __future__ import annotations

import json
import os
import selectors
import signal
import socket
import sqlite3
import stat
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import httpx
import pytest


BACKEND_DIR = Path(__file__).resolve().parents[2]
SIDECAR = BACKEND_DIR / "packaging" / "sidecar.py"
SECRET_KEY_FILE = "django_secret_key"
SNAPSHOT_GLOB = "state.db.pre-migration.*"


def _free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def _sidecar_command(port: int, data_dir: Path) -> list[str]:
    binary = os.environ.get("MUXED_SIDECAR_BINARY")
    command = [binary] if binary else [sys.executable, str(SIDECAR)]
    return [*command, "--port", str(port), "--data-dir", str(data_dir)]


def _entrypoint_command(*args: str) -> list[str]:
    binary = os.environ.get("MUXED_SIDECAR_BINARY")
    command = [binary] if binary else [sys.executable, str(SIDECAR)]
    return [*command, *args]


def _isolated_sidecar_environment() -> dict[str, str]:
    environment = os.environ.copy()
    for name in (
        "MUXED_DATA_DIR",
        "MUXED_ADMIN_ENABLED",
        "MUXED_DESKTOP_ORIGIN",
        "MUXED_SIDECAR_CREDENTIAL",
        "MUXED_STATE_DB",
        "DJANGO_SETTINGS_MODULE",
        "WORKTRACKER_API_TOKEN",
        "WORKTRACKER_DISABLE_AUTH",
    ):
        environment.pop(name, None)
    return environment


def _assert_database_startup_failure(data_dir: Path) -> None:
    result = subprocess.run(
        _sidecar_command(43_219, data_dir),
        cwd=data_dir,
        env=_isolated_sidecar_environment(),
        text=True,
        capture_output=True,
        timeout=30,
    )

    assert result.returncode == 1
    assert (
        result.stdout.splitlines().count(
            "MUXED_FAILURE migration database could not be migrated"
        )
        == 1
    )
    assert '"event":"ready"' not in result.stdout


def _prepare_pending_database(data_dir: Path) -> Path:
    database_path = data_dir / "state.db"
    environment = _isolated_sidecar_environment()
    environment.update(
        {
            "MUXED_DATA_DIR": str(data_dir),
            "MUXED_STATE_DB": str(database_path),
            "MUXED_SKIP_LOCAL_STATE_MIGRATION": "1",
        }
    )
    subprocess.run(
        [
            sys.executable,
            str(BACKEND_DIR / "manage.py"),
            "migrate",
            "worktracker",
            "0025_per_type_transitions",
            "--noinput",
            "--verbosity",
            "0",
        ],
        cwd=BACKEND_DIR,
        env=environment,
        text=True,
        capture_output=True,
        timeout=30,
        check=True,
    )
    return database_path


def test_sidecar_reports_migration_failure_once_and_exits_nonzero(tmp_path):
    (tmp_path / "state.db").mkdir()

    _assert_database_startup_failure(tmp_path)


def test_sidecar_reports_provisioning_failure_as_migration_failure(tmp_path):
    (tmp_path / "worktracker_token").mkdir()

    _assert_database_startup_failure(tmp_path)


def test_sidecar_dispatches_packaged_lifecycle_hooks():
    result = subprocess.run(
        _entrypoint_command(
            "hook",
            "codex",
            "--agent-run-id",
            "run-packaged",
            "--lifecycle-url",
            "http://127.0.0.1:1/api/lifecycle/events",
        ),
        input=json.dumps({"hook_event_name": "SessionStart"}),
        text=True,
        capture_output=True,
        timeout=10,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert "--port" not in result.stderr


def test_sidecar_rejects_unknown_packaged_hook():
    result = subprocess.run(
        _entrypoint_command("hook", "typo"),
        text=True,
        capture_output=True,
        timeout=10,
    )

    assert result.returncode == 2
    assert result.stdout == ""
    assert "typo" in result.stderr


@pytest.mark.skipif(
    not os.environ.get("MUXED_SIDECAR_BINARY"),
    reason="requires the built desktop sidecar",
)
def test_packaged_sidecar_starts_mcp_and_completes_initialize():
    port = _free_port()
    environment = os.environ.copy()
    environment.update(
        {
            "MCP_HOST": "127.0.0.1",
            "MCP_PORT": str(port),
            "MCP_TRANSPORT": "http",
            "WORKTRACKER_BASE_URL": "http://127.0.0.1:1/api/work-tracker",
            "WORKTRACKER_API_KEY": "packaged-smoke",
            "STUDIO_RUN_CONTROL_URL": "http://127.0.0.1:1",
        }
    )
    process = subprocess.Popen(
        _entrypoint_command("mcp"),
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        deadline = time.monotonic() + 30
        response = None
        while time.monotonic() < deadline:
            if process.poll() is not None:
                output = process.stdout.read().decode() if process.stdout else ""
                raise AssertionError(f"packaged MCP exited before readiness:\n{output}")
            try:
                response = httpx.post(
                    f"http://127.0.0.1:{port}/mcp",
                    headers={"Accept": "application/json, text/event-stream"},
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2025-03-26",
                            "capabilities": {},
                            "clientInfo": {"name": "packaged-smoke", "version": "1"},
                        },
                    },
                    timeout=2,
                )
                break
            except httpx.ConnectError:
                time.sleep(0.05)
        assert response is not None, "packaged MCP did not bind before the deadline"
        assert response.status_code == 200
        assert '"name":"worktracker-agent"' in response.text
    finally:
        process.terminate()
        assert process.wait(timeout=10) in {0, -signal.SIGTERM}


def test_sidecar_migrates_authenticates_and_stops(tmp_path):
    port = _free_port()
    credential = "ephemeral-test-credential"
    environment = {
        key: value
        for key, value in os.environ.items()
        if key
        not in {
            "MUXED_DATA_DIR",
            "MUXED_DESKTOP_ORIGIN",
            "MUXED_STATE_DB",
            "DJANGO_SETTINGS_MODULE",
            "WORKTRACKER_API_TOKEN",
            "WORKTRACKER_DISABLE_AUTH",
        }
    }
    environment["MUXED_SIDECAR_CREDENTIAL"] = credential
    environment["MUXED_ADMIN_ENABLED"] = "true"
    process = subprocess.Popen(
        _sidecar_command(port, tmp_path),
        cwd=tmp_path,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        assert process.stdout is not None
        deadline = time.monotonic() + 30
        output = b""
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        while time.monotonic() < deadline:
            if not selector.select(timeout=0.25):
                continue
            chunk = os.read(process.stdout.fileno(), 8192)
            if not chunk:
                if process.poll() is not None:
                    raise AssertionError("sidecar exited before readiness")
                continue
            output += chunk
            lines = output.splitlines()
            output = b"" if output.endswith(b"\n") else lines.pop()
            for line in lines:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if event.get("event") == "ready":
                    break
            else:
                continue
            break
        else:
            raise AssertionError("sidecar did not emit a readiness line")

        url = f"http://127.0.0.1:{port}/api/work-tracker/projects"
        assert (
            httpx.get(url, headers={"x-api-key": credential}, timeout=5).status_code
            == 200
        )
        config_response = httpx.get(
            f"http://127.0.0.1:{port}/api/config",
            headers={"x-api-key": credential},
            timeout=5,
        )
        assert config_response.status_code == 200
        assert config_response.json() == {
            "recent_profile_index": 0,
            "profiles": [
                {
                    "name": "Local",
                    "workspace_slug": "meml",
                    "agent_prompt": None,
                    "agent_prompts": {},
                    "module_folders": {},
                    "recent_project_id": None,
                    "recent_module_ids": {},
                }
            ],
        }
        assert (
            httpx.get(url, headers={"x-api-key": "wrong"}, timeout=5).status_code == 401
        )
        assert (
            httpx.get(
                url,
                headers={"x-api-key": credential, "Origin": "http://untrusted.invalid"},
                timeout=5,
            ).status_code
            == 403
        )
        assert (
            httpx.get(
                url,
                headers={"x-api-key": credential, "Origin": "http://tauri.localhost"},
                timeout=5,
            ).status_code
            == 200
        )
        preflight = httpx.options(
            url,
            headers={
                "Origin": "http://tauri.localhost",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-api-key",
            },
            timeout=5,
        )
        assert preflight.status_code == 204
        assert (
            preflight.headers["access-control-allow-origin"] == "http://tauri.localhost"
        )
        assert "x-api-key" in preflight.headers["access-control-allow-headers"]
        assert (
            httpx.get(f"http://127.0.0.1:{port}/wt-admin/", timeout=5).status_code
            == 404
        )
        assert (tmp_path / "state.db").is_file()
        with sqlite3.connect(tmp_path / "state.db") as connection:
            superuser_count = connection.execute(
                "SELECT COUNT(*) FROM auth_user WHERE is_superuser = 1"
            ).fetchone()[0]
        assert superuser_count == 0
        assert list(tmp_path.glob(SNAPSHOT_GLOB)) == []
    finally:
        process.terminate()
        assert process.wait(timeout=10) == 0


def _wait_for_readiness(process: subprocess.Popen[bytes]) -> None:
    assert process.stdout is not None
    deadline = time.monotonic() + 30
    output = b""
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    while time.monotonic() < deadline:
        if not selector.select(timeout=0.25):
            continue
        chunk = os.read(process.stdout.fileno(), 8192)
        if not chunk:
            if process.poll() is not None:
                raise AssertionError("sidecar exited before readiness")
            continue
        output += chunk
        lines = output.splitlines()
        output = b"" if output.endswith(b"\n") else lines.pop()
        for line in lines:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("event") == "ready":
                return
    raise AssertionError("sidecar did not emit a readiness line")


@contextmanager
def _running_sidecar(data_dir: Path, **environment_overrides: str):
    port = _free_port()
    environment = os.environ.copy()
    environment.update(environment_overrides)
    process = subprocess.Popen(
        _sidecar_command(port, data_dir),
        cwd=data_dir,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        _wait_for_readiness(process)
        yield port
    finally:
        process.terminate()
        assert process.wait(timeout=10) == 0


def test_pending_migration_creates_consistent_private_bounded_snapshot(tmp_path):
    database_path = _prepare_pending_database(tmp_path)
    writer = sqlite3.connect(database_path)
    writer.execute("PRAGMA journal_mode=WAL")
    writer.execute("PRAGMA wal_autocheckpoint=0")
    writer.execute("CREATE TABLE snapshot_probe (value TEXT NOT NULL)")
    writer.execute("INSERT INTO snapshot_probe VALUES ('latest committed value')")
    writer.commit()

    for generation, content in (
        (1, b"previous newest"),
        (2, b"previous middle"),
        (3, b"previous oldest"),
    ):
        (tmp_path / f"state.db.pre-migration.{generation}").write_bytes(content)

    try:
        with _running_sidecar(tmp_path):
            snapshot_path = tmp_path / "state.db.pre-migration.1"
            assert snapshot_path.is_file()
            assert stat.S_IMODE(snapshot_path.stat().st_mode) == 0o600

            snapshot = sqlite3.connect(snapshot_path)
            try:
                assert snapshot.execute("PRAGMA integrity_check").fetchone() == ("ok",)
                assert snapshot.execute(
                    "SELECT value FROM snapshot_probe"
                ).fetchone() == ("latest committed value",)
                assert snapshot.execute(
                    """
                    SELECT COUNT(*) FROM django_migrations
                    WHERE app = 'worktracker'
                      AND name = '0026_delete_legacy_workflow_models'
                    """
                ).fetchone() == (0,)
            finally:
                snapshot.close()

            assert (
                tmp_path / "state.db.pre-migration.2"
            ).read_bytes() == b"previous newest"
            assert (
                tmp_path / "state.db.pre-migration.3"
            ).read_bytes() == b"previous middle"
            assert not (tmp_path / "state.db.pre-migration.4").exists()
    finally:
        writer.close()

    first_snapshot = (tmp_path / "state.db.pre-migration.1").read_bytes()
    with _running_sidecar(tmp_path):
        assert (tmp_path / "state.db.pre-migration.1").read_bytes() == first_snapshot
        assert len(list(tmp_path.glob(SNAPSHOT_GLOB))) == 3


def test_snapshot_failure_aborts_before_migrating(tmp_path):
    database_path = _prepare_pending_database(tmp_path)
    secret_path = tmp_path / SECRET_KEY_FILE
    secret_path.write_text("existing-private-secret")
    secret_path.chmod(0o600)
    tmp_path.chmod(0o500)
    try:
        _assert_database_startup_failure(tmp_path)
    finally:
        tmp_path.chmod(0o700)

    database = sqlite3.connect(database_path)
    try:
        assert database.execute(
            """
            SELECT COUNT(*) FROM django_migrations
            WHERE app = 'worktracker'
              AND name = '0026_delete_legacy_workflow_models'
            """
        ).fetchone() == (0,)
    finally:
        database.close()
    assert list(tmp_path.glob(SNAPSHOT_GLOB)) == []


def test_packaged_posture_is_forced_and_secret_survives_restarts(tmp_path):
    inherited_development_secret = "inherited-development-secret"
    environment = {
        "MUXED_DEBUG": "true",
        "MUXED_SECRET_KEY": inherited_development_secret,
        "MUXED_ALLOWED_HOSTS": "*",
    }

    with _running_sidecar(tmp_path, **environment) as port:
        secret_file = tmp_path / SECRET_KEY_FILE
        assert secret_file.is_file()
        assert list(tmp_path.glob(SNAPSHOT_GLOB)) == []
        first_secret = secret_file.read_text()
        assert first_secret
        assert first_secret != inherited_development_secret
        assert first_secret != "muxed-localhost-only"
        assert stat.S_IMODE(secret_file.stat().st_mode) == 0o600

        loopback_response = httpx.get(
            f"http://127.0.0.1:{port}/api/config",
            headers={"Host": "localhost"},
            timeout=5,
        )
        assert loopback_response.status_code == 200

        rejected_host = httpx.get(
            f"http://127.0.0.1:{port}/api/config",
            headers={"Host": "untrusted.invalid"},
            timeout=5,
        )
        assert rejected_host.status_code == 400
        assert "DisallowedHost" not in rejected_host.text
        assert inherited_development_secret not in rejected_host.text

    with _running_sidecar(tmp_path, **environment):
        assert (tmp_path / SECRET_KEY_FILE).read_text() == first_secret
        assert list(tmp_path.glob(SNAPSHOT_GLOB)) == []


def test_shared_settings_keep_development_defaults():
    environment = os.environ.copy()
    for name in (
        "MUXED_ADMIN_ENABLED",
        "MUXED_DEBUG",
        "MUXED_SECRET_KEY",
        "MUXED_ALLOWED_HOSTS",
    ):
        environment.pop(name, None)
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import json; from studio_server import settings; "
                "print(json.dumps([settings.DEBUG, settings.SECRET_KEY, "
                "settings.ALLOWED_HOSTS, settings.ADMIN_ENABLED]))"
            ),
        ],
        cwd=BACKEND_DIR,
        env=environment,
        text=True,
        capture_output=True,
        timeout=10,
        check=True,
    )

    assert json.loads(result.stdout) == [True, "muxed-localhost-only", ["*"], True]
