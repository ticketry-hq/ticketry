"""Contract checks for the packaged backend entry point."""

from __future__ import annotations

import hashlib
import json
import os
import selectors
import signal
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
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
        "MUXED_HOOK_SPOOL_DIR",
        "MUXED_SKILL_SMOKE_REPOSITORY",
        "MUXED_SIDECAR_CREDENTIAL",
        "MUXED_STATE_DB",
        "MUXED_APPROVED_AGY_PATH",
        "MUXED_APPROVED_CLAUDE_PATH",
        "MUXED_APPROVED_CODEX_PATH",
        "MUXED_APPROVED_GEMINI_PATH",
        "DJANGO_SETTINGS_MODULE",
        "CODEX_HOME",
        "GEMINI_CLI_HOME",
        "WORKTRACKER_API_TOKEN",
        "WORKTRACKER_DISABLE_AUTH",
    ):
        environment.pop(name, None)
    # Startup installs required provider skills. Keep subprocess tests away
    # from the developer's real provider configuration.
    environment["HOME"] = str(
        Path(tempfile.gettempdir()) / f"ticketry-sidecar-test-home-{os.getpid()}"
    )
    runner = environment.get("MUXED_HOOK_RUNNER_BINARY")
    if runner:
        environment["MUXED_PACKAGED_HOOK_RUNNER"] = runner
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


def test_sidecar_refuses_a_structurally_corrupt_database(tmp_path):
    with _running_sidecar(tmp_path):
        pass

    database_path = tmp_path / "state.db"
    with sqlite3.connect(database_path) as database:
        page_size = database.execute("PRAGMA page_size").fetchone()[0]
        root_page = database.execute(
            """
            SELECT rootpage
            FROM sqlite_master
            WHERE type = 'index'
              AND name = 'worktracker_issue_rank_0fa0887c'
            """
        ).fetchone()[0]

    with database_path.open("r+b") as database_file:
        database_file.seek((root_page - 1) * page_size)
        database_file.write(b"\0")

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


def test_sidecar_resolves_and_verifies_packaged_skills_without_network():
    environment = _isolated_sidecar_environment()
    environment.update(
        {
            "NO_PROXY": "127.0.0.1,localhost",
            "HTTP_PROXY": "http://127.0.0.1:1",
            "HTTPS_PROXY": "http://127.0.0.1:1",
            "ALL_PROXY": "http://127.0.0.1:1",
        }
    )

    result = subprocess.run(
        _entrypoint_command("skills", "verify"),
        cwd=Path("/"),
        env=environment,
        text=True,
        capture_output=True,
        timeout=30,
    )

    assert result.returncode == 0, result.stderr
    verified = json.loads(result.stdout)
    assert verified["commit"] == "ed37663cc5fbef691ddfecd080dff42f7e7e350d"
    assert set(verified["packages"]) == {
        "code-review",
        "grill-with-docs",
        "implement",
        "tdd",
        "to-spec",
        "to-tickets",
        "grilling",
        "domain-modeling",
        "setup-matt-pocock-skills",
    }


def test_sidecar_install_and_verify_installation_commands_are_offline(tmp_path):
    home = tmp_path / "home"
    environment = _isolated_sidecar_environment()
    environment.update(
        {
            "HOME": str(home),
            "NO_PROXY": "127.0.0.1,localhost",
            "HTTP_PROXY": "http://127.0.0.1:1",
            "HTTPS_PROXY": "http://127.0.0.1:1",
            "ALL_PROXY": "http://127.0.0.1:1",
        }
    )

    installed = subprocess.run(
        _entrypoint_command("skills", "install"),
        cwd=Path("/"),
        env=environment,
        text=True,
        capture_output=True,
        timeout=30,
    )
    verified = subprocess.run(
        _entrypoint_command("skills", "verify-installation"),
        cwd=Path("/"),
        env=environment,
        text=True,
        capture_output=True,
        timeout=30,
    )

    assert installed.returncode == 0, installed.stderr
    assert verified.returncode == 0, verified.stderr
    assert set(json.loads(installed.stdout)["installed"]) == {
        "claude",
        "codex",
        "agy",
        "gemini",
    }
    assert set(json.loads(verified.stdout)["verified"]) == {
        "claude",
        "codex",
        "agy",
        "gemini",
    }


def _file_snapshot(root: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(root)): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


def test_sidecar_installs_and_smokes_every_packaged_provider_offline(
    tmp_path,
):
    home = tmp_path / "fresh-home"
    repository = tmp_path / "repository"
    for root in (home, repository):
        for provider in ("claude", "codex", "agy", "gemini"):
            config = root / f".{provider}" / "settings"
            config.parent.mkdir(parents=True, exist_ok=True)
            config.write_bytes(f"{root.name}:{provider}:unchanged\n".encode())
    before_home = _file_snapshot(home)
    before_repository = _file_snapshot(repository)

    environment = _isolated_sidecar_environment()
    environment.update(
        {
            "HOME": str(home),
            "MUXED_SKILL_SMOKE_REPOSITORY": str(repository),
            "NO_PROXY": "127.0.0.1,localhost",
            "HTTP_PROXY": "http://127.0.0.1:1",
            "HTTPS_PROXY": "http://127.0.0.1:1",
            "ALL_PROXY": "http://127.0.0.1:1",
        }
    )
    result = subprocess.run(
        _entrypoint_command("skills", "smoke-providers"),
        cwd=Path("/"),
        env=environment,
        text=True,
        capture_output=True,
        timeout=30,
    )

    assert result.returncode == 0, result.stderr
    smoke = json.loads(result.stdout)
    expected = {
        "code-review",
        "grill-with-docs",
        "implement",
        "tdd",
        "to-spec",
        "to-tickets",
        "grilling",
        "domain-modeling",
        "setup-matt-pocock-skills",
    }
    assert set(smoke["providers"]) == {"claude", "codex", "agy", "gemini"}
    assert all(set(names) == expected for names in smoke["providers"].values())
    assert smoke["mcp_configured"] == {
        "claude": True,
        "codex": True,
        "agy": True,
        "gemini": True,
    }
    after_home = _file_snapshot(home)
    for path, contents in before_home.items():
        assert after_home[path] == contents
    assert after_home.keys() > before_home.keys()
    assert _file_snapshot(repository) == before_repository
    overlay_parent = Path(tempfile.gettempdir()) / "ticketry-agent-runs"
    assert all(
        not (overlay_parent / f"packaged-smoke-{provider}").exists()
        for provider in smoke["providers"]
    )


@pytest.mark.skipif(
    not os.environ.get("MUXED_HOOK_RUNNER_BINARY"),
    reason="requires the built sandbox-safe hook runner",
)
def test_packaged_hook_spool_updates_the_run_state(tmp_path):
    """The shipped native hook and frozen backend compose end to end."""

    runner = os.environ["MUXED_HOOK_RUNNER_BINARY"]
    run_id = "packaged-hook-run"
    with _running_sidecar(
        tmp_path,
        MUXED_PACKAGED_HOOK_RUNNER=runner,
    ) as port:
        headers = {"x-api-key": (tmp_path / "worktracker_token").read_text().strip()}
        base_url = f"http://127.0.0.1:{port}/api/work-tracker"
        workspace_response = httpx.get(
            f"{base_url}/workspace", headers=headers, timeout=30
        )
        assert workspace_response.status_code == 200
        assert workspace_response.json()["slug"] == "meml"
        project_response = httpx.post(
            f"{base_url}/projects",
            headers=headers,
            json={"name": "Packaged hook", "slug": "PKG"},
            timeout=5,
        )
        assert project_response.status_code == 200
        project_id = project_response.json()["id"]

        issue_types_response = httpx.get(
            f"{base_url}/projects/{project_id}/issue-types",
            headers=headers,
            timeout=5,
        )
        assert issue_types_response.status_code == 200
        issue_types = issue_types_response.json()
        module_type_id = next(
            issue_type["id"]
            for issue_type in issue_types
            if issue_type["level"] == "module"
        )
        task_type_id = next(
            issue_type["id"]
            for issue_type in issue_types
            if issue_type["name"] == "Story"
        )

        module_response = httpx.post(
            f"{base_url}/projects/{project_id}/modules",
            headers=headers,
            json={"name": "Packaged hook", "issue_type_id": module_type_id},
            timeout=5,
        )
        assert module_response.status_code == 200
        module_id = module_response.json()["id"]
        task_response = httpx.post(
            f"{base_url}/projects/{project_id}/work-items",
            headers=headers,
            json={
                "name": "Packaged hook",
                "parent_id": module_id,
                "issue_type_id": task_type_id,
            },
            timeout=5,
        )
        assert task_response.status_code == 200
        task_id = task_response.json()["id"]

        with sqlite3.connect(tmp_path / "state.db") as database:
            database.execute(
                """
                INSERT INTO agent_runs (
                    id, issue_id, agent, status,
                    started_at, lifecycle_state, lifecycle_updated_at, scope
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    task_id.replace("-", ""),
                    "codex",
                    "running",
                    "2020-01-01T00:00:00+00:00",
                    "unknown",
                    "2020-01-01T00:00:00+00:00",
                    "task",
                ),
            )
            database.execute(
                """
                INSERT INTO agent_terminal_sessions (
                    agent_run_id, tmux_session_name, task_id, module_id,
                    project_id, agent, created_at, scope
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    f"pt-{run_id}",
                    task_id,
                    module_id,
                    project_id,
                    "codex",
                    "2020-01-01T00:00:00+00:00",
                    "task",
                ),
            )

        spool_identity = hashlib.sha256(
            str(tmp_path.resolve()).encode("utf-8")
        ).hexdigest()[:16]
        spool_dir = (
            Path(tempfile.gettempdir()) / f"ticketry-hook-spool-{spool_identity}"
        )
        result = subprocess.run(
            [
                runner,
                "hook",
                "codex",
                "--spool-dir",
                str(spool_dir),
                "--agent-run-id",
                run_id,
                "--lifecycle-url",
                "http://127.0.0.1:1/api/lifecycle/events",
            ],
            input=json.dumps(
                {
                    "hook_event_name": "SessionStart",
                    "session_id": "packaged-provider-session",
                }
            ),
            text=True,
            capture_output=True,
            timeout=10,
        )
        assert result.returncode == 0
        assert result.stdout == ""
        assert result.stderr == ""

        deadline = time.monotonic() + 5
        stored = None
        while time.monotonic() < deadline:
            with sqlite3.connect(tmp_path / "state.db") as database:
                stored = database.execute(
                    """
                    SELECT lifecycle_state, provider_session_id
                    FROM agent_runs WHERE id = ?
                    """,
                    (run_id,),
                ).fetchone()
            if stored == ("starting", "packaged-provider-session"):
                break
            time.sleep(0.05)
        assert stored == ("starting", "packaged-provider-session")


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
def test_frozen_backend_refuses_to_start_without_native_hook_runner(tmp_path):
    environment = _isolated_sidecar_environment()
    environment.pop("MUXED_PACKAGED_HOOK_RUNNER", None)
    environment.pop("MUXED_HOOK_RUNNER_BINARY", None)

    result = subprocess.run(
        _sidecar_command(_free_port(), tmp_path),
        cwd=tmp_path,
        env=environment,
        text=True,
        capture_output=True,
        timeout=30,
    )

    assert result.returncode == 1
    assert (
        result.stdout.splitlines().count("MUXED_FAILURE crash sidecar could not start")
        == 1
    )
    assert "packaged hook runner is missing" in result.stderr


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
        workspace_url = f"http://127.0.0.1:{port}/api/work-tracker/workspace"
        workspace_response = httpx.get(
            workspace_url, headers={"x-api-key": credential}, timeout=30
        )
        assert workspace_response.status_code == 200
        assert workspace_response.json()["slug"] == "meml"
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
            "features": {"sidebar": False, "projects": False},
            "profiles": [
                {
                    "name": "Local",
                    "workspace_slug": "meml",
                    "agent_prompt": None,
                    "agent_prompts": {},
                    "module_links": [],
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
                headers={"x-api-key": credential, "Origin": "tauri://localhost"},
                timeout=5,
            ).status_code
            == 200
        )
        preflight = httpx.options(
            url,
            headers={
                "Origin": "tauri://localhost",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-api-key",
            },
            timeout=5,
        )
        assert preflight.status_code == 204
        assert preflight.headers["access-control-allow-origin"] == "tauri://localhost"
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
    environment = _isolated_sidecar_environment()
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


def test_sidecar_startup_installs_skills_before_readiness(tmp_path):
    home = tmp_path / "home"
    data_dir = tmp_path / "data"
    data_dir.mkdir()

    with _running_sidecar(data_dir, HOME=str(home)):
        pass

    expected = {
        "code-review",
        "domain-modeling",
        "grill-with-docs",
        "grilling",
        "implement",
        "setup-matt-pocock-skills",
        "tdd",
        "to-spec",
        "to-tickets",
    }
    roots = (
        home / ".claude/skills",
        home / ".codex/skills",
        home / ".agy/skills",
        home / ".gemini/skills",
    )
    for root in roots:
        assert {path.name for path in root.iterdir() if path.is_dir()} == expected


def test_sidecar_startup_refuses_a_user_owned_skill_collision(tmp_path):
    home = tmp_path / "home"
    conflict = home / ".codex/skills/to-spec"
    conflict.mkdir(parents=True)
    (conflict / "SKILL.md").write_text("---\nname: to-spec\n---\nuser-owned\n")
    data_dir = tmp_path / "data"
    environment = _isolated_sidecar_environment()
    environment["HOME"] = str(home)

    result = subprocess.run(
        _sidecar_command(_free_port(), data_dir),
        cwd=tmp_path,
        env=environment,
        text=True,
        capture_output=True,
        timeout=30,
    )

    assert result.returncode == 1
    assert "skill_installation_failed" in result.stderr
    assert "Refusing to overwrite" in result.stderr
    assert '"event":"ready"' not in result.stdout
    assert (conflict / "SKILL.md").read_text().endswith("user-owned\n")


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


def test_an_empty_secret_key_is_a_reported_failure_not_a_retried_timeout(tmp_path):
    """``configure_environment`` used to raise outside the failure handler.

    Its create path was not atomic, so a crash or a second process in the
    window left the secret file existing and empty; every later start then
    raised before any ``MUXED_FAILURE`` line was printed. The supervisor read
    that as a readiness timeout and retried a deterministic failure until the
    restart budget was gone (H5).
    """

    (tmp_path / SECRET_KEY_FILE).write_text("")

    result = subprocess.run(
        _sidecar_command(_free_port(), tmp_path),
        cwd=tmp_path,
        env=_isolated_sidecar_environment(),
        text=True,
        capture_output=True,
        timeout=30,
    )

    assert result.returncode == 1
    assert (
        result.stdout.splitlines().count("MUXED_FAILURE crash sidecar could not start")
        == 1
    )
    assert '"event":"ready"' not in result.stdout
    # The give-up screen should name a cause, so the traceback still ships.
    assert "packaged secret key is empty" in result.stderr


def test_a_packaged_start_leaves_no_active_superuser(tmp_path):
    """A packaged install ships without an administrative surface (T1419).

    An install upgraded from a pre-T1419 build carries a superuser created
    with the old ``admin``/``admin`` defaults. The packaged start has to close
    it, not merely stop routing to it.
    """

    with _running_sidecar(tmp_path):
        pass

    database = sqlite3.connect(tmp_path / "state.db")
    try:
        database.execute(
            "INSERT INTO auth_user (password, is_superuser, username, first_name,"
            " last_name, email, is_staff, is_active, date_joined)"
            " VALUES ('!', 1, 'admin', '', '', '', 1, 1, '2026-07-27 00:00:00')"
        )
        database.commit()
    finally:
        database.close()

    with _running_sidecar(tmp_path):
        pass

    database = sqlite3.connect(tmp_path / "state.db")
    try:
        remaining = database.execute(
            "SELECT COUNT(*) FROM auth_user"
            " WHERE is_active = 1 AND (is_staff = 1 OR is_superuser = 1)"
        ).fetchone()[0]
    finally:
        database.close()

    assert remaining == 0


def test_shared_settings_keep_development_defaults_but_close_the_admin():
    """The localhost defaults stay; the admin surface is not one of them.

    ``MUXED_ADMIN_ENABLED`` unset must mean *off*, so any start of this code
    that is not an explicit dev entrypoint — ``manage.py runserver`` against a
    packaged data dir, a launcher that forgets the variable — cannot bring
    ``wt-admin/`` back (T1419 / ADR-0013).
    """

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

    assert json.loads(result.stdout) == [True, "muxed-localhost-only", ["*"], False]
