use sea_orm::{ConnectionTrait, Database, DatabaseConnection};

pub(super) async fn bind_existing_instant_thread(
    directory: &tempfile::TempDir,
) -> DatabaseConnection {
    let database = Database::connect(format!(
        "sqlite:{}",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    database
        .execute_unprepared(
            "UPDATE agent_runs SET scope='instant', provider_session_id='thread-active' \
             WHERE id='run-valid'; \
             UPDATE agent_terminal_sessions SET scope='instant' WHERE agent_run_id='run-valid'",
        )
        .await
        .unwrap();
    database
}

pub(super) async fn snapshot(database: &DatabaseConnection) -> String {
    let row = database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "SELECT json_object( \
                'run', r.id, 'provider', r.provider_session_id, \
                'manualTitle', r.conversation_title, 'status', r.status, \
                'endedAt', r.ended_at, 'scope', r.scope, \
                'terminal', t.agent_run_id, 'tmux', t.tmux_session_name, \
                'namespace', t.runtime_namespace, 'terminatedAt', t.terminated_at \
             ) AS snapshot FROM agent_runs r \
             JOIN agent_terminal_sessions t ON t.agent_run_id=r.id WHERE r.id='run-valid'"
                .to_owned(),
        ))
        .await
        .unwrap()
        .unwrap();
    row.try_get("", "snapshot").unwrap()
}
