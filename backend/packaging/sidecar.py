"""Standalone entry point for the packaged Django ASGI backend."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import secrets
import shutil
import signal
import sys
import tempfile
import threading
import traceback
from pathlib import Path

from studio_server.atomic_files import atomic_write_bytes


CREDENTIAL_ENV = "MUXED_SIDECAR_CREDENTIAL"
DEFAULT_DESKTOP_ORIGIN = "tauri://localhost"
MIGRATION_FAILURE_LINE = "MUXED_FAILURE migration database could not be migrated"
STARTUP_FAILURE_LINE = "MUXED_FAILURE crash sidecar could not start"
SNAPSHOT_RETENTION = 3
POSTGRES_MIGRATION_LOCK_ID = 0x5449434B45545259

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ticketry backend sidecar")
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--data-dir", required=True, type=Path)
    return parser.parse_args(argv)


def load_or_create_secret_key(data_dir: Path) -> str:
    """Return the install's persistent Django signing secret.

    The create path writes to a temporary file and renames it into place, so
    the secret only ever becomes visible complete. An ``O_CREAT|O_EXCL`` open
    followed by a separate write has a window — a second sidecar arriving in
    it, or a crash between the two steps — that leaves the file existing and
    empty, which every later start then reads and rejects. With a rename the
    loser of that race is harmless: it discards its own candidate and reads
    the winner's.
    """

    secret_path = data_dir / "django_secret_key"
    if not secret_path.exists():
        atomic_write_bytes(
            secret_path,
            secrets.token_urlsafe(48).encode(),
            mode=0o600,
            fsync=True,
        )

    os.chmod(secret_path, 0o600)
    secret = secret_path.read_text()
    if not secret:
        raise RuntimeError(f"packaged secret key is empty: {secret_path}")
    return secret


def configure_environment(args: argparse.Namespace) -> None:
    """Set the isolated runtime configuration before Django imports settings."""

    data_dir = args.data_dir.expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["MUXED_DATA_DIR"] = str(data_dir)
    os.environ["MUXED_STATE_DB"] = str(data_dir / "state.db")
    os.environ["MUXED_ADMIN_ENABLED"] = "false"
    os.environ["MUXED_DEBUG"] = "false"
    os.environ["MUXED_SECRET_KEY"] = load_or_create_secret_key(data_dir)
    os.environ["MUXED_ALLOWED_HOSTS"] = "localhost,127.0.0.1,[::1]"
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "studio_server.settings")
    os.environ.setdefault("MUXED_DESKTOP_ORIGIN", DEFAULT_DESKTOP_ORIGIN)
    credential = os.environ.get(CREDENTIAL_ENV, "")
    if credential:
        os.environ["WORKTRACKER_API_TOKEN"] = credential
        # A development shell can inherit this variable.  A sidecar supplied a
        # credential must always enforce it.
        os.environ["WORKTRACKER_DISABLE_AUTH"] = "false"


def _snapshot_path(database_path: Path, generation: int) -> Path:
    return database_path.with_name(f"{database_path.name}.pre-migration.{generation}")


def _create_pre_migration_snapshot(database_path: Path, connection) -> None:
    with connection.cursor() as cursor:
        checkpoint = cursor.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
    if checkpoint and checkpoint[0] != 0:
        raise RuntimeError("state database WAL checkpoint did not complete")

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{database_path.name}.pre-migration.",
        suffix=".tmp",
        dir=database_path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with (
            database_path.open("rb") as source,
            os.fdopen(descriptor, "wb") as destination,
        ):
            descriptor = -1
            shutil.copyfileobj(source, destination)
            destination.flush()
            os.fsync(destination.fileno())

        _snapshot_path(database_path, SNAPSHOT_RETENTION).unlink(missing_ok=True)
        for generation in range(SNAPSHOT_RETENTION - 1, 0, -1):
            existing = _snapshot_path(database_path, generation)
            if existing.exists():
                os.replace(existing, _snapshot_path(database_path, generation + 1))
        os.replace(temporary_path, _snapshot_path(database_path, 1))
    except BaseException:
        if descriptor >= 0:
            os.close(descriptor)
        temporary_path.unlink(missing_ok=True)
        raise


def _verify_database_integrity(connection) -> None:
    """Refuse to report readiness for a structurally damaged state database."""

    with connection.cursor() as cursor:
        result = cursor.execute("PRAGMA quick_check(1)").fetchone()
    if result != ("ok",):
        detail = result[0] if result else "no result"
        raise RuntimeError(f"state database integrity check failed: {detail}")


@contextlib.contextmanager
def _database_migration_lock(connection):
    """Serialize schema setup when several sidecars share one Postgres DB."""

    if connection.vendor != "postgresql":
        yield
        return

    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_lock(%s)", [POSTGRES_MIGRATION_LOCK_ID])
    try:
        yield
    finally:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_unlock(%s)", [POSTGRES_MIGRATION_LOCK_ID])


def migrate_and_provision() -> None:
    import django
    from django.core.management import call_command
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor

    django.setup()
    database_path = Path(os.environ["MUXED_STATE_DB"])
    database_existed = database_path.is_file()
    with _database_migration_lock(connection):
        if connection.vendor == "sqlite":
            _verify_database_integrity(connection)
        executor = MigrationExecutor(connection)
        migrations_pending = bool(
            executor.migration_plan(executor.loader.graph.leaf_nodes())
        )
        if connection.vendor == "sqlite" and database_existed and migrations_pending:
            _create_pre_migration_snapshot(database_path, connection)

        call_command("migrate", interactive=False, verbosity=1)
        provision_output = io.StringIO()
        call_command("provision", stdout=provision_output)

        from django.conf import settings

        provisioned = json.loads(provision_output.getvalue())
        # Provision may generate the first-run token after Django settings have
        # loaded. Make that credential authoritative for the running process as
        # well as the persisted token file.
        settings.WORKTRACKER_API_TOKEN = provisioned["token"]


def readiness_line(port: int) -> str:
    return json.dumps(
        {
            "event": "ready",
            "host": "127.0.0.1",
            "port": port,
            "credential_required": bool(os.environ.get(CREDENTIAL_ENV)),
        },
        separators=(",", ":"),
    )


def serve(port: int) -> None:
    import uvicorn

    class ReadyServer(uvicorn.Server):
        @contextlib.contextmanager
        def capture_signals(self):
            """Let SIGTERM stop Uvicorn gracefully without re-raising it."""

            if threading.current_thread() is not threading.main_thread():
                yield
                return
            handled = (signal.SIGINT, signal.SIGTERM)
            original = {sig: signal.signal(sig, self.handle_exit) for sig in handled}
            try:
                yield
            finally:
                for sig, handler in original.items():
                    signal.signal(sig, handler)

        async def startup(self, sockets=None):
            await super().startup(sockets=sockets)
            # ``uvicorn`` marks itself started only after the socket is bound.
            print(readiness_line(port), flush=True)

    config = uvicorn.Config(
        "studio_server.asgi:application",
        host="127.0.0.1",
        port=port,
        log_level="info",
        access_log=False,
    )
    ReadyServer(config).run()


def run_mcp() -> int:
    """Run the packaged WorkTracker MCP service from the same artifact."""

    if os.environ.get("TICKETRY_RUST_WORKTRACKER_OWNER", "").lower() in {
        "1",
        "true",
        "yes",
    }:
        print(
            "Legacy Python WorkTracker MCP is disabled after Rust write ownership transfers.",
            file=sys.stderr,
        )
        return 2

    from worktracker_agent.mcp.main import main as mcp_main

    mcp_main()
    return 0


def run_skills(command: str) -> int:
    """Install or smoke-test the bundled provider-visible skill catalog."""

    from apps.terminals.agents.injectors.agy import build_agy_mcp_servers
    from apps.terminals.agents.injectors.claude import build_claude_mcp_config
    from apps.terminals.agents.injectors.codex import build_codex_mcp_servers
    from apps.terminals.agents.injectors.gemini import build_gemini_mcp_servers
    from apps.terminals.agents.skills.catalog import verify_catalog
    from apps.terminals.agents.skills.installation import (
        SUPPORTED_PROVIDERS,
        install_packaged_skills,
        visible_skill_candidates,
    )

    lock = verify_catalog()
    names = tuple(package["name"] for package in lock["packages"])
    home = Path.home()
    install_packaged_skills(home=home, environ=os.environ)
    if command == "install":
        print(json.dumps({"installed": list(SUPPORTED_PROVIDERS)}, separators=(",", ":")))
        return 0

    providers = {}
    mcp_url = "http://127.0.0.1:8123/mcp"
    authorization = "Bearer packaged-smoke"
    mcp_configured = {
        "claude": "worktracker-agent"
        in build_claude_mcp_config(mcp_url, authorization)["mcpServers"],
        "codex": "worktracker-agent"
        in build_codex_mcp_servers(mcp_url, authorization),
        "agy": "worktracker-agent"
        in build_agy_mcp_servers(mcp_url, authorization),
        "gemini": "worktracker-agent"
        in build_gemini_mcp_servers(mcp_url, authorization),
    }
    for provider in SUPPORTED_PROVIDERS:
        visible = visible_skill_candidates(
            provider,
            names=names,
            home=home,
            environ=os.environ,
        )
        providers[provider] = sorted(name for name, paths in visible.items() if paths)
    print(
        json.dumps(
            {"providers": providers, "mcp_configured": mcp_configured},
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv == ["mcp"]:
        return run_mcp()
    if argv in (["skills", "install"], ["skills", "smoke-providers"]):
        return run_skills(argv[1])
    args = parse_args(argv)
    if not 0 < args.port < 65536:
        raise SystemExit("--port must be between 1 and 65535")
    # Environment setup can fail deterministically (an empty secret-key file,
    # an unwritable data dir). Outside a handler that raise printed no failure
    # line, so the supervisor saw only a readiness timeout and retried a start
    # that was never going to succeed. Classify it as ``crash`` instead.
    try:
        configure_environment(args)
    except BaseException as exc:
        if isinstance(exc, KeyboardInterrupt):
            raise
        traceback.print_exc()
        print(STARTUP_FAILURE_LINE, flush=True)
        return 1
    try:
        migrate_and_provision()
    except BaseException as exc:
        # ``call_command`` can raise SystemExit, which is not an ``Exception``
        # and used to escape without a failure line — H5's symptom again.
        if isinstance(exc, KeyboardInterrupt):
            raise
        traceback.print_exc()
        print(MIGRATION_FAILURE_LINE, flush=True)
        return 1
    serve(args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
