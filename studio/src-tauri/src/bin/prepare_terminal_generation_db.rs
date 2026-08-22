use sea_orm::{ConnectOptions, ConnectionTrait, Database};

#[tokio::main]
async fn main() {
    let output = std::env::args_os()
        .nth(1)
        .map(std::path::PathBuf::from)
        .expect("usage: prepare_terminal_generation_db <output.sqlite3>");
    if output.exists() {
        std::fs::remove_file(&output).expect("remove prior generation database");
    }
    let database_path = output.clone();
    let mut options = ConnectOptions::new("sqlite:terminal-generation.sqlite3?mode=rwc");
    options.map_sqlx_sqlite_opts(move |options| {
        options
            .filename(&database_path)
            .create_if_missing(true)
            .foreign_keys(true)
    });
    let database = Database::connect(options)
        .await
        .expect("create terminal generation database");
    database
        .execute_unprepared(
            "CREATE TABLE worktracker_issue (id varchar(32) PRIMARY KEY);\n\
             CREATE TABLE agent_runs (\n\
               id varchar(255) PRIMARY KEY, issue_id varchar(32) NOT NULL REFERENCES worktracker_issue(id),\n\
               ticket_seq integer, agent varchar(32), model varchar(255), reasoning varchar(255),\n\
               status varchar(32) NOT NULL, started_at varchar(255) NOT NULL, ended_at varchar(255),\n\
               exit_code integer, error text, cwd text, provider_session_id varchar(255),\n\
               lifecycle_state varchar(32), lifecycle_updated_at varchar(255), design_dir text,\n\
               resumed_from varchar(255), scope varchar(32) NOT NULL,\n\
               launch_state varchar(255), launch_model varchar(255)\n\
             );\n\
             CREATE TABLE agent_terminal_sessions (\n\
               agent_run_id varchar(255) PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,\n\
               tmux_session_name varchar(255) NOT NULL, task_id varchar(32) NOT NULL,\n\
               module_id varchar(32) NOT NULL, project_id varchar(32) NOT NULL,\n\
               created_at varchar(255) NOT NULL, terminated_at varchar(255), scope varchar(32) NOT NULL,\n\
               doc_rel_path text, runtime_cleanup_pending boolean NOT NULL, runtime_namespace varchar(64),\n\
               output_identity varchar(255), output_sequence bigint NOT NULL, last_output_at varchar(255),\n\
               agent varchar(32)\n\
             );",
        )
        .await
        .expect("install terminal generation schema");
    database.close().await.expect("close generation database");
    println!("{}", output.display());
}
