"""Adoption + fresh-migrate guards for the shared ``state.db``.

``dev.mjs`` runs ``migrate --fake-initial``
against the live ``~/.config/worktracker-studio/state.db`` on every startup, so
adopting a pre-existing database in place is ongoing runtime behaviour,
not a one-off. These tests pin that behaviour:

- a legacy database (app tables + ``alembic_version``, no
  ``django_migrations``) is adopted with rows and version row intact;
- a fresh ``migrate`` builds the hardened schema (WAL, foreign keys), omits
  the retired terminal table, and preserves viewer-lease cascade semantics.

The reference schema is built from the models' own ``schema_editor`` DDL
(identical to the initial migrations) rather than the retired Alembic
stack, so the suite no longer depends on ``core.state_db``.
"""

import copy
import os
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from django.db import connections

from apps.documents.models import DesignDocument
from apps.runs.models import AgentRun
from apps.settings_store.models import AppSetting
from apps.terminals.models import AgentRunViewerLease
from worktracker.models import Issue, IssueType, Project, Workspace


_SCHEMA_OBJECTS = (
    "agent_runs",
    "app_settings",
    "design_documents",
    "idx_design_documents_task",
)

# Models in FK order: parents before children.

_APP_MODELS = (AppSetting, DesignDocument)

_ORCHESTRATOR_TABLES = (
    "orchestrator_facts",
    "orchestrator_run_nodes",
    "orchestrator_headless_runs",
    "orchestrator_runs",
)


@pytest.fixture
def isolated_database(django_db_blocker):
    """Create temporary Django aliases for isolated SQLite files."""

    aliases = []

    def use(db_path):
        alias = f"isolated_{uuid.uuid4().hex}"
        config = copy.deepcopy(connections.databases["default"])
        config["NAME"] = db_path
        connections.databases[alias] = config
        aliases.append(alias)
        return alias, connections[alias]

    with django_db_blocker.unblock():
        yield use
        for alias in aliases:
            connections[alias].close()
            del connections.databases[alias]


def _schema_objects(db_path):
    """Return the names of the application tables and indexes present."""

    placeholders = ", ".join("?" for _ in _SCHEMA_OBJECTS)
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            f"SELECT name FROM sqlite_master WHERE name IN ({placeholders})",
            _SCHEMA_OBJECTS,
        ).fetchall()
    return {name for (name,) in rows}


def _assert_no_orchestrator_tables(db_connection):
    placeholders = ", ".join(["%s"] * len(_ORCHESTRATOR_TABLES))
    with db_connection.cursor() as cursor:
        cursor.execute(
            f"SELECT name FROM sqlite_master WHERE type = 'table' "
            f"AND name IN ({placeholders})",
            _ORCHESTRATOR_TABLES,
        )
        assert cursor.fetchall() == []


def _migrate_in_subprocess(
    db_path: Path,
    *,
    fake_initial: bool = False,
    target: tuple[str, str] | None = None,
) -> None:
    """Run migrations with ``db_path`` as the real default database.

    Several historical data migrations predate multi-database tests and query
    the default alias directly. A subprocess mirrors the production startup
    contract and avoids giving those migrations a misleading secondary alias.
    """

    backend_root = Path(__file__).resolve().parents[2]
    data_dir = db_path.parent / "config"
    data_dir.mkdir(exist_ok=True)
    command = [sys.executable, str(backend_root / "manage.py"), "migrate"]
    if target is not None:
        command.extend(target)
    command.append("--noinput")
    if fake_initial:
        command.append("--fake-initial")
    environment = os.environ.copy()
    environment.update(
        MUXED_SKIP_LOCAL_STATE_MIGRATION="1",
        MUXED_DATA_DIR=str(data_dir),
        MUXED_STATE_DB=str(db_path),
    )
    subprocess.run(
        command,
        cwd=backend_root,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )


def _build_legacy_database(db_connection, db_path):
    """Shape ``db_path`` like a pre-Django, Alembic-era ``state.db``.

    Creates the four application tables via the models' own DDL, then adds
    an ``alembic_version`` row and one seed row per table — but no
    ``django_migrations``, mirroring a database Django has never touched.

    :param db_connection: Django connection bound to ``db_path``.
    :param db_path: filesystem path of the SQLite database.
    """

    # Current non-run application schema, no Django bookkeeping tables.

    with db_connection.schema_editor() as schema_editor:
        for model in _APP_MODELS:
            schema_editor.create_model(model)

    with sqlite3.connect(db_path) as conn:
        # Recreate the two pre-normalization 0001 tables byte-for-byte enough
        # for --fake-initial adoption. Later migrations establish Issue
        # authority, copy child-only context, and drop the child table.
        conn.executescript(
            """
            CREATE TABLE agent_runs (
                id VARCHAR NOT NULL PRIMARY KEY,
                workspace_slug VARCHAR,
                project_id VARCHAR NOT NULL,
                module_id VARCHAR NOT NULL,
                task_id VARCHAR,
                ticket_seq INTEGER,
                agent VARCHAR NOT NULL,
                status VARCHAR NOT NULL,
                started_at VARCHAR NOT NULL,
                ended_at VARCHAR,
                exit_code INTEGER,
                error VARCHAR,
                cwd VARCHAR,
                provider_session_id VARCHAR,
                lifecycle_state VARCHAR,
                lifecycle_updated_at VARCHAR,
                design_dir VARCHAR
            );
            CREATE INDEX idx_agent_runs_task_started_at
                ON agent_runs (task_id, started_at DESC);
            CREATE TABLE agent_terminal_sessions (
                agent_run_id VARCHAR NOT NULL PRIMARY KEY,
                tmux_session_name VARCHAR NOT NULL,
                task_id VARCHAR NOT NULL,
                module_id VARCHAR NOT NULL,
                project_id VARCHAR NOT NULL,
                agent VARCHAR NOT NULL,
                created_at VARCHAR NOT NULL,
                terminated_at VARCHAR,
                scope VARCHAR DEFAULT 'task' NOT NULL,
                doc_rel_path VARCHAR,
                FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_agent_terminal_sessions_task_created
                ON agent_terminal_sessions (task_id, terminated_at, created_at DESC);
            """
        )
        conn.execute("CREATE TABLE alembic_version (version_num varchar(32) NOT NULL)")
        conn.execute(
            "INSERT INTO alembic_version (version_num) VALUES (?)",
            ("0006_design_documents",),
        )
        conn.execute(
            """
            INSERT INTO agent_runs (
                id, workspace_slug, project_id, module_id, task_id, ticket_seq,
                agent, status, started_at, design_dir
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "run-1",
                "meml",
                "project-1",
                "module-1",
                "task-1",
                527,
                "codex",
                "running",
                "2026-06-12T12:00:00+00:00",
                "/tmp/designs",
            ),
        )
        conn.execute(
            """
            INSERT INTO agent_terminal_sessions (
                agent_run_id, tmux_session_name, task_id, module_id,
                project_id, agent, created_at, scope
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "run-1",
                "pt-run-1",
                "task-1",
                "module-1",
                "project-1",
                "codex",
                "2026-06-12T12:00:00+00:00",
                "task",
            ),
        )
        conn.execute(
            """
            INSERT INTO app_settings (scope, "key", value, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            ("global", "panel_width", "42", "2026-06-12T12:00:00+00:00"),
        )
        conn.execute(
            """
            INSERT INTO design_documents (
                id, module_id, task_id, scope, root_dir, rel_path,
                discovered_by_run_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "doc-1",
                "module-1",
                "task-1",
                "task",
                "/tmp/designs",
                "report.html",
                "run-1",
                "2026-06-12T12:00:00+00:00",
                "2026-06-12T12:00:00+00:00",
            ),
        )


def test_fake_initial_adopts_existing_database_without_data_change(
    tmp_path,
    isolated_database,
):
    """Adopt a pre-Django database and discard an unreferencable run."""

    db_path = tmp_path / "state.db"
    alias, db_connection = isolated_database(db_path)
    _build_legacy_database(db_connection, db_path)

    # The real startup command: adopt the existing schema in place.

    db_connection.close()
    _migrate_in_subprocess(db_path, fake_initial=True)

    with db_connection.cursor() as cursor:
        cursor.execute("SELECT version_num FROM alembic_version")
        assert cursor.fetchone() == ("0006_design_documents",)
        cursor.execute(
            """
            SELECT app, name FROM django_migrations
            WHERE app IN ('runs', 'terminals', 'settings_store', 'documents')
            ORDER BY app
            """
        )
        assert cursor.fetchall() == [
            ("documents", "0001_initial"),
            ("runs", "0001_initial"),
            # Post-initial migrations apply for real during adoption; the
            # legacy fixture ships the 0001 schema without resumed_from.
            ("runs", "0002_agentrun_resumed_from"),
            ("runs", "0003_drop_orchestrator_tables"),
            ("runs", "0004_automationattempt"),
            ("runs", "0005_automationattempt_retry"),
            ("runs", "0006_agentrun_scope"),
            # Data-only, and a no-op for this fixture: the seeded run has no
            # ended_at, so the terminal-state backfill skips it and the rows
            # below still survive adoption untouched.
            ("runs", "0007_backfill_terminal_lifecycle_state"),
            ("runs", "0008_agentrun_issue"),
            ("runs", "0009_collapse_terminal_session"),
            ("runs", "0010_remove_agentrun_ticket_seq"),
            ("settings_store", "0001_initial"),
            ("settings_store", "0002_migrate_profile_prompt_authority"),
            ("terminals", "0001_initial"),
            ("terminals", "0002_agent_run_viewer_lease"),
            ("terminals", "0003_delete_agentterminalsession"),
        ]

    # The unreferencable legacy run and its terminal mirror are intentionally
    # removed by 0008; unrelated adopted rows survive untouched.

    assert not AgentRun.objects.using(alias).exists()
    assert "agent_terminal_sessions" not in db_connection.introspection.table_names()
    assert AppSetting.objects.using(alias).get().value == "42"
    assert DesignDocument.objects.using(alias).get().rel_path == "report.html"


def test_fresh_migrate_sets_pragmas_and_viewer_lease_cascade(
    tmp_path,
    isolated_database,
):
    """Create a fresh schema with hardened connections and FK cascade."""

    db_path = tmp_path / "state.db"
    alias, db_connection = isolated_database(db_path)

    db_connection.close()
    _migrate_in_subprocess(db_path)

    # All named application tables and indexes are present.

    assert _schema_objects(db_path) == set(_SCHEMA_OBJECTS)

    _assert_no_orchestrator_tables(db_connection)

    with db_connection.cursor() as cursor:
        cursor.execute("PRAGMA journal_mode")
        assert cursor.fetchone()[0].lower() == "wal"
        cursor.execute("PRAGMA foreign_keys")
        assert cursor.fetchone() == (1,)

    workspace = Workspace.objects.using(alias).create(
        id=uuid.uuid4(), slug="state-adoption", name="State adoption"
    )
    project = Project.objects.using(alias).create(
        id=uuid.uuid4(), workspace=workspace, name="Project", slug="PROJECT"
    )
    issue_type = IssueType.objects.using(alias).create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    issue = Issue(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=issue_type,
        name="Module",
        sequence_id=1,
    )
    Issue.objects.using(alias).bulk_create([issue])
    run = AgentRun.objects.using(alias).create(
        id="run-1",
        issue=issue,
        agent="codex",
        status="running",
        started_at="2026-06-12T12:00:00+00:00",
        scope="plan",
    )
    AgentRunViewerLease.objects.using(alias).create(
        agent_run=run,
        viewer_id="viewer-1",
        transport="desktop",
        acquired_at="2026-06-12T12:00:00+00:00",
        expires_at="2026-06-12T12:01:00+00:00",
    )

    run.delete(using=alias)
    with db_connection.cursor() as cursor:
        cursor.execute(
            "SELECT COUNT(*) FROM agent_run_viewer_leases WHERE agent_run_id = %s",
            ["run-1"],
        )
        assert cursor.fetchone() == (0,)


def test_migrate_drops_legacy_orchestrator_tables(tmp_path, isolated_database):
    """The surviving runs migration removes the retired product's data tables."""

    db_path = tmp_path / "state.db"
    alias, db_connection = isolated_database(db_path)
    with db_connection.cursor() as cursor:
        cursor.execute("CREATE TABLE orchestrator_runs (id varchar(32) PRIMARY KEY)")
        cursor.execute(
            "CREATE TABLE orchestrator_headless_runs (id varchar(32) PRIMARY KEY)"
        )
        cursor.execute(
            "CREATE TABLE orchestrator_run_nodes ("
            "id varchar(32) PRIMARY KEY, run_id varchar(32) REFERENCES orchestrator_runs(id))"
        )
        cursor.execute(
            "CREATE TABLE orchestrator_facts ("
            "id varchar(32) PRIMARY KEY, run_id varchar(32) REFERENCES orchestrator_runs(id))"
        )

    db_connection.close()
    _migrate_in_subprocess(db_path)

    _assert_no_orchestrator_tables(db_connection)


def test_terminal_collapse_copies_doc_context_and_unprojected_termination(
    tmp_path, isolated_database
):
    """The table drop preserves the only child facts that are not derivable."""

    db_path = tmp_path / "state.db"
    alias, db_connection = isolated_database(db_path)
    db_connection.close()
    _migrate_in_subprocess(db_path, target=("runs", "0008_agentrun_issue"))

    workspace = Workspace.objects.using(alias).create(
        id=uuid.uuid4(), slug="collapse", name="Collapse"
    )
    project = Project.objects.using(alias).create(
        id=uuid.uuid4(), workspace=workspace, name="Project", slug="COLLAPSE"
    )
    module_type = IssueType.objects.using(alias).create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    module = Issue(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Module",
        sequence_id=1,
    )
    Issue.objects.using(alias).bulk_create([module])

    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO agent_runs (
                id, issue_id, ticket_seq, agent, status, started_at, scope
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            [
                "run-collapse",
                module.id.hex,
                99,
                "codex",
                "running",
                "2026-08-08T10:00:00+00:00",
                "docchat",
            ],
        )
        cursor.execute(
            """
            INSERT INTO agent_terminal_sessions (
                agent_run_id, tmux_session_name, task_id, module_id,
                project_id, agent, created_at, terminated_at, scope,
                doc_rel_path
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                "run-collapse",
                "pt-run-collapse",
                "00000000-0000-0000-0000-000000000000",
                str(module.id),
                str(project.id),
                "codex",
                "2026-08-08T10:00:01+00:00",
                "2026-08-08T10:05:00+00:00",
                "docchat",
                "spec/normalized.html",
            ],
        )

    db_connection.close()
    _migrate_in_subprocess(db_path)

    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT doc_rel_path, ended_at, status, lifecycle_state,
                   terminal_owner_id
            FROM agent_runs WHERE id = %s
            """,
            ["run-collapse"],
        )
        assert cursor.fetchone() == (
            "spec/normalized.html",
            "2026-08-08T10:05:00+00:00",
            "terminated",
            "exited",
            "legacy",
        )
    assert "agent_terminal_sessions" not in db_connection.introspection.table_names()
