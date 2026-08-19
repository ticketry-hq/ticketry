"""Restore the database-level ON DELETE CASCADE onto ``agent_runs``.

``0001_initial`` deliberately rebuilt ``agent_terminal_sessions`` with a raw
``FOREIGN KEY ... ON DELETE CASCADE`` so a bare SQL delete of an agent run
sweeps its terminal mirror without the ORM. Later ``AlterField`` migrations
(most recently ``0006_terminal_session_optional_agent``) rebuilt the table with
Django's generated DDL, which never emits an ``ON DELETE`` action, silently
downgrading the cascade to ``NO ACTION``. ``agent_run_viewer_leases`` was
created by generated DDL and never had the cascade its model's
``on_delete=CASCADE`` promises.

Rebuild both tables once, preserving rows and indexes, with the cascade spelled
out in the schema itself. The hardened schema contract applies to the SQLite
``state.db``; on other backends the ORM's Python-level cascade remains the
delete path, so the rebuild is skipped.
"""

from django.db import migrations


_REBUILD_SESSIONS = """
CREATE TABLE "agent_terminal_sessions__cascade" (
    "agent_run_id" varchar NOT NULL PRIMARY KEY
        REFERENCES "agent_runs" ("id") ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED,
    "tmux_session_name" varchar NOT NULL,
    "task_id" varchar NOT NULL,
    "module_id" varchar NOT NULL,
    "project_id" varchar NOT NULL,
    "created_at" varchar NOT NULL,
    "terminated_at" varchar NULL,
    "scope" varchar DEFAULT 'task' NOT NULL,
    "doc_rel_path" varchar NULL,
    "runtime_cleanup_pending" bool NOT NULL,
    "runtime_namespace" varchar(64) NULL,
    "output_identity" varchar(64) NULL,
    "output_sequence" bigint NOT NULL,
    "last_output_at" varchar NULL,
    "agent" varchar NULL
);
INSERT INTO "agent_terminal_sessions__cascade"
    SELECT "agent_run_id", "tmux_session_name", "task_id", "module_id",
           "project_id", "created_at", "terminated_at", "scope",
           "doc_rel_path", "runtime_cleanup_pending", "runtime_namespace",
           "output_identity", "output_sequence", "last_output_at", "agent"
    FROM "agent_terminal_sessions";
DROP TABLE "agent_terminal_sessions";
ALTER TABLE "agent_terminal_sessions__cascade"
    RENAME TO "agent_terminal_sessions";
CREATE INDEX "agent_terminal_sessions_runtime_namespace_a928a9d9"
    ON "agent_terminal_sessions" ("runtime_namespace");
CREATE INDEX "idx_agent_terminal_sessions_task_created"
    ON "agent_terminal_sessions" ("task_id", "terminated_at", "created_at" DESC);
"""

_REBUILD_LEASES = """
CREATE TABLE "agent_run_viewer_leases__cascade" (
    "agent_run_id" varchar NOT NULL PRIMARY KEY
        REFERENCES "agent_runs" ("id") ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED,
    "viewer_id" varchar(64) NOT NULL,
    "transport" varchar(16) NOT NULL,
    "acquired_at" datetime NOT NULL,
    "expires_at" datetime NOT NULL
);
INSERT INTO "agent_run_viewer_leases__cascade"
    SELECT "agent_run_id", "viewer_id", "transport", "acquired_at", "expires_at"
    FROM "agent_run_viewer_leases";
DROP TABLE "agent_run_viewer_leases";
ALTER TABLE "agent_run_viewer_leases__cascade"
    RENAME TO "agent_run_viewer_leases";
"""


def restore_cascade(apps, schema_editor):
    if schema_editor.connection.vendor != "sqlite":
        return
    for script in (_REBUILD_SESSIONS, _REBUILD_LEASES):
        for statement in script.split(";"):
            if statement.strip():
                schema_editor.execute(statement)


class Migration(migrations.Migration):
    dependencies = [("terminals", "0006_terminal_session_optional_agent")]

    operations = [
        migrations.RunPython(restore_cascade, migrations.RunPython.noop),
    ]
