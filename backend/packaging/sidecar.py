"""Standalone entry point for the packaged Django ASGI backend."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib
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


CREDENTIAL_ENV = "MUXED_SIDECAR_CREDENTIAL"
DEFAULT_DESKTOP_ORIGIN = "http://tauri.localhost"
PACKAGED_HOOK_RUNNER_ENV = "MUXED_PACKAGED_HOOK_RUNNER"
HOOK_SPOOL_DIR_ENV = "MUXED_HOOK_SPOOL_DIR"
MIGRATION_FAILURE_LINE = "MUXED_FAILURE migration database could not be migrated"
STARTUP_FAILURE_LINE = "MUXED_FAILURE crash sidecar could not start"
SNAPSHOT_RETENTION = 3

HOOK_MODULES = {
    "agy": "apps.terminals.agents.hooks.agy_hook",
    "claude": "apps.terminals.agents.hooks.claude_hook",
    "codex": "apps.terminals.agents.hooks.codex_hook",
    "gemini": "apps.terminals.agents.hooks.gemini_hook",
}


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
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=".django_secret_key.",
            suffix=".tmp",
            dir=data_dir,
        )
        temporary_path = Path(temporary_name)
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "w") as secret_file:
                descriptor = -1
                secret_file.write(secrets.token_urlsafe(48))
                secret_file.flush()
                os.fsync(secret_file.fileno())
            os.replace(temporary_path, secret_path)
        except BaseException:
            if descriptor >= 0:
                os.close(descriptor)
            temporary_path.unlink(missing_ok=True)
            raise

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
    os.environ["MUXED_LIFECYCLE_URL"] = (
        f"http://127.0.0.1:{args.port}/api/lifecycle/events"
    )
    # Packaged agent hooks execute under provider command sandboxes.  Give the
    # tiny native hook transport a stable, private temp spool that survives a
    # backend restart for this installation/worktree.  The backend drains the
    # files and performs the normal lifecycle ingest outside the sandbox.
    spool_identity = hashlib.sha256(str(data_dir).encode("utf-8")).hexdigest()[:16]
    hook_spool_dir = (
        Path(tempfile.gettempdir()) / f"ticketry-hook-spool-{spool_identity}"
    )
    hook_spool_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(hook_spool_dir, 0o700)
    os.environ[HOOK_SPOOL_DIR_ENV] = str(hook_spool_dir)
    if getattr(sys, "frozen", False):
        # Re-entering this one-file PyInstaller binary from an agent command
        # sandbox is not a valid fallback: its bootloader needs a semaphore the
        # sandbox denies. Fail startup visibly if packaging ever omits the
        # dedicated native runner instead of launching sessions with hooks that
        # are guaranteed to fail.
        packaged_runner = os.environ.get(PACKAGED_HOOK_RUNNER_ENV)
        if not packaged_runner or not Path(packaged_runner).is_file():
            raise RuntimeError("packaged hook runner is missing")

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


def migrate_and_provision() -> None:
    import django
    from django.core.management import call_command
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor

    database_path = Path(os.environ["MUXED_STATE_DB"])
    database_existed = database_path.is_file()
    django.setup()
    executor = MigrationExecutor(connection)
    migrations_pending = bool(
        executor.migration_plan(executor.loader.graph.leaf_nodes())
    )
    if database_existed and migrations_pending:
        _create_pre_migration_snapshot(database_path, connection)

    call_command("migrate", interactive=False, verbosity=1)
    provision_output = io.StringIO()
    call_command("provision", stdout=provision_output)

    from apps.settings_store import service as settings_service

    provisioned = json.loads(provision_output.getvalue())
    settings_service.ensure_local_profile(
        name="Local",
        workspace_slug=provisioned["workspace_slug"],
    )


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


def run_hook(argv: list[str]) -> int:
    """Dispatch one agent hook through code embedded in the frozen binary."""

    if not argv or argv[0] not in HOOK_MODULES:
        hook_name = argv[0] if argv else "<missing>"
        print(f"Unknown hook: {hook_name}", file=sys.stderr)
        return 2
    module = importlib.import_module(HOOK_MODULES[argv[0]])
    sys.argv = [f"muxed-backend hook {argv[0]}", *argv[1:]]
    module._reporter.run(module.SPEC)
    return 0


def run_mcp() -> int:
    """Run the packaged WorkTracker MCP service from the same artifact."""

    from worktracker_agent.mcp.main import main as mcp_main

    mcp_main()
    return 0


def verify_skill_catalog() -> int:
    """Verify resources through the same import path used by the frozen app."""

    from apps.terminals.agents.skills import verify_catalog

    lock = verify_catalog()
    print(
        json.dumps(
            {
                "commit": lock["upstream"]["commit"],
                "packages": [package["name"] for package in lock["packages"]],
            },
            separators=(",", ":"),
        )
    )
    return 0


def install_skill_catalog() -> int:
    """Install or safely upgrade pinned skills in provider-native roots."""

    from apps.terminals.agents.skills.installation import install_packaged_skills

    installed = install_packaged_skills()
    print(
        json.dumps(
            {
                "installed": {
                    provider: str(path) for provider, path in installed.items()
                }
            },
            separators=(",", ":"),
        )
    )
    return 0


def verify_skill_installations() -> int:
    """Verify the persistent provider installations without changing them."""

    from apps.terminals.agents.skills.installation import verify_all_installations

    installed = verify_all_installations()
    print(
        json.dumps(
            {
                "verified": {
                    provider: str(path) for provider, path in installed.items()
                }
            },
            separators=(",", ":"),
        )
    )
    return 0


def smoke_skill_providers() -> int:
    """Exercise persistent installation and native discovery for every provider."""

    with tempfile.TemporaryDirectory(prefix="ticketry-skill-smoke-") as temporary:
        smoke_root = Path(temporary)
        os.environ.setdefault("MUXED_DATA_DIR", str(smoke_root / "data"))
        os.environ.setdefault("MUXED_STATE_DB", str(smoke_root / "data/state.db"))
        os.environ.setdefault("MUXED_SKIP_LOCAL_STATE_MIGRATION", "1")
        os.environ.setdefault("DJANGO_SETTINGS_MODULE", "studio_server.settings")

        import django

        django.setup()

        from apps.terminals.agents.registry import (
            cleanup_temporary_artifacts,
            get_adapter,
        )
        from apps.terminals.agents.skills.installation import (
            install_packaged_skills,
            provider_skill_root,
        )
        from apps.terminals.agents.skills.preflight import resolve_required_skills

        configured_repository = os.environ.get("MUXED_SKILL_SMOKE_REPOSITORY")
        repository = (
            Path(configured_repository).resolve()
            if configured_repository
            else smoke_root / "repository"
        )
        repository.mkdir(parents=True, exist_ok=True)
        requested = ("grill-with-docs", "to-spec", "to-tickets")
        discovered: dict[str, list[str]] = {}
        mcp_configured: dict[str, bool] = {}
        install_packaged_skills()

        for provider in ("claude", "codex", "agy", "gemini"):
            adapter = get_adapter(provider)
            resolved = resolve_required_skills(
                provider=provider,
                required_skills=requested,
                cwd=str(repository),
                supports_required_skills=adapter.supports_required_skills,
                available_tools=adapter.available_worktracker_tools,
            )
            augmentation = adapter.augment_launch(
                [provider, "packaged offline smoke"],
                f"packaged-smoke-{provider}",
                lifecycle_url="http://127.0.0.1:1/api/lifecycle/events",
                mcp_url="http://127.0.0.1:1/mcp",
                skills=resolved,
            )
            try:
                argv = list(augmentation.argv)
                environment = dict(augmentation.environment)
                names = {
                    path.name
                    for path in provider_skill_root(provider).iterdir()
                    if path.is_dir()
                }
                if provider == "claude":
                    mcp_configured[provider] = any(
                        "worktracker-agent" in value for value in argv
                    )
                elif provider == "codex":
                    mcp_configured[provider] = any(
                        "worktracker-agent" in value for value in argv
                    )
                elif provider == "agy":
                    settings_path = Path(
                        environment["GEMINI_CLI_SYSTEM_SETTINGS_PATH"]
                    )
                    settings = json.loads(settings_path.read_text(encoding="utf-8"))
                    mcp_configured[provider] = "worktracker-agent" in settings[
                        "mcpServers"
                    ]
                else:
                    settings_path = Path(
                        environment["GEMINI_CLI_SYSTEM_SETTINGS_PATH"]
                    )
                    settings = json.loads(settings_path.read_text(encoding="utf-8"))
                    mcp_configured[provider] = "worktracker-agent" in settings[
                        "mcpServers"
                    ]
                if names != set(resolved.names):
                    raise RuntimeError(
                        f"{provider} did not expose the complete packaged closure"
                    )
                discovered[provider] = sorted(names)
            finally:
                cleanup_temporary_artifacts(augmentation.temporary_artifacts)

        print(
            json.dumps(
                {
                    "providers": discovered,
                    "mcp_configured": mcp_configured,
                },
                separators=(",", ":"),
            )
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["hook"]:
        return run_hook(argv[1:])
    if argv == ["mcp"]:
        return run_mcp()
    if argv == ["skills", "verify"]:
        return verify_skill_catalog()
    if argv == ["skills", "install"]:
        return install_skill_catalog()
    if argv == ["skills", "verify-installation"]:
        return verify_skill_installations()
    if argv == ["skills", "smoke-providers"]:
        return smoke_skill_providers()
    args = parse_args(argv)
    if not 0 < args.port < 65536:
        raise SystemExit("--port must be between 1 and 65535")
    # Environment setup can fail deterministically (an empty secret-key file,
    # an unwritable data dir). Outside a handler that raise printed no failure
    # line, so the supervisor saw only a readiness timeout and retried a start
    # that was never going to succeed. Classify it as ``crash`` instead.
    try:
        configure_environment(args)
        from apps.terminals.agents.skills.installation import install_packaged_skills

        install_packaged_skills()
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
