"""Adoption + fresh-migrate guards for the shared ``state.db``.

``dev.mjs`` runs ``migrate --fake-initial``
against the live ``~/.config/worktracker-studio/state.db`` on every startup, so
adopting a pre-existing database in place is ongoing runtime behaviour,
not a one-off. These tests pin that behaviour:

- a legacy database (app tables + ``alembic_version``, no
  ``django_migrations``) is adopted with rows and version row intact;
- a fresh ``migrate`` builds the hardened schema (WAL, foreign keys) and
  the FK cascade fires.

The reference schema is built from the models' own ``schema_editor`` DDL
(identical to the initial migrations) rather than the retired Alembic
stack, so the suite no longer depends on ``core.state_db``.
"""

import copy
import sqlite3
import uuid

import pytest
from django.core.management import call_command
from django.db import connections

from apps.documents.models import DesignDocument
from apps.runs.models import AgentRun
from apps.settings_store.models import AppSetting
from apps.terminals.models import AgentTerminalSession
from worktracker.models import Issue, IssueType, Project, Workspace


_SCHEMA_OBJECTS = (
    "agent_runs",
    "agent_terminal_sessions",
    "idx_agent_terminal_sessions_task_created",
    "app_settings",
    "design_documents",
    "idx_design_documents_task",
)

# Models in FK order: parents before children.

_APP_MODELS = (AgentRun, AgentTerminalSession, AppSetting, DesignDocument)

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


def _build_legacy_database(db_connection, db_path):
    """Shape ``db_path`` like a pre-Django, Alembic-era ``state.db``.

    Creates the four application tables via the models' own DDL, then adds
    an ``alembic_version`` row and one seed row per table — but no
    ``django_migrations``, mirroring a database Django has never touched.

    :param db_connection: Django connection bound to ``db_path``.
    :param db_path: filesystem path of the SQLite database.
    """

    # Byte-matched application schema, no Django bookkeeping tables.

    with db_connection.schema_editor() as schema_editor:
        for model in _APP_MODELS:
            schema_editor.create_model(model)

    with sqlite3.connect(db_path) as conn:
        # create_model() emits the current AgentRun foreign key. Rebuild that
        # table to the exact pre-0008 shape so the adoption migration can add
        # and backfill the Issue relation itself.
        conn.executescript(
            """
            DROP TABLE agent_runs;
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

            DROP TABLE agent_terminal_sessions;
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
                FOREIGN KEY(agent_run_id)
                    REFERENCES agent_runs (id) ON DELETE CASCADE
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
                "11111111-1111-1111-1111-111111111111",
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

    call_command("migrate", database=alias, fake_initial=True, verbosity=0)

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
            ("runs", "0009_automationattempt_launch_rejection"),
            ("runs", "0010_chat_runs"),
            ("runs", "0011_agentchatcommand"),
            ("runs", "0012_agentchatlaunchcommand"),
            ("settings_store", "0001_initial"),
            ("settings_store", "0002_migrate_profile_prompt_authority"),
            ("terminals", "0001_initial"),
            ("terminals", "0002_agent_run_viewer_lease"),
        ]

    # The unreferencable legacy run and its terminal mirror are intentionally
    # removed by 0008; unrelated adopted rows survive untouched.

    assert not AgentRun.objects.using(alias).exists()
    assert not AgentTerminalSession.objects.using(alias).exists()
    assert AppSetting.objects.using(alias).get().value == "42"
    assert DesignDocument.objects.using(alias).get().rel_path == "report.html"


def test_fresh_migrate_sets_pragmas_and_database_cascade(
    tmp_path,
    isolated_database,
):
    """Create a fresh schema with hardened connections and FK cascade."""

    db_path = tmp_path / "state.db"
    alias, db_connection = isolated_database(db_path)

    call_command("migrate", database=alias, verbosity=0)

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
    issue = Issue.objects.using(alias).create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=issue_type,
        name="Module",
        sequence_id=1,
    )
    run = AgentRun.objects.using(alias).create(
        id="run-1",
        issue=issue,
        agent="codex",
        status="running",
        started_at="2026-06-12T12:00:00+00:00",
        scope="plan",
    )
    AgentTerminalSession.objects.using(alias).create(
        agent_run=run,
        tmux_session_name="pt-run-1",
        task_id="task-1",
        module_id="module-1",
        project_id="project-1",
        agent="codex",
        created_at="2026-06-12T12:00:00+00:00",
    )

    with db_connection.cursor() as cursor:
        cursor.execute("DELETE FROM agent_runs WHERE id = %s", ["run-1"])
        cursor.execute(
            "SELECT COUNT(*) FROM agent_terminal_sessions WHERE agent_run_id = %s",
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

    call_command("migrate", database=alias, verbosity=0)

    _assert_no_orchestrator_tables(db_connection)
