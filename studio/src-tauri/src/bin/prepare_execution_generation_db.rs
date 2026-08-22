use sea_orm::{ConnectOptions, ConnectionTrait, Database};

#[tokio::main]
async fn main() {
    let output = std::env::args_os()
        .nth(1)
        .map(std::path::PathBuf::from)
        .expect("usage: prepare_execution_generation_db <output.sqlite3>");
    if output.exists() {
        std::fs::remove_file(&output).expect("remove prior generation database");
    }
    let database_path = output.clone();
    let mut options = ConnectOptions::new("sqlite:execution-generation.sqlite3?mode=rwc");
    options.map_sqlx_sqlite_opts(move |options| {
        options
            .filename(&database_path)
            .create_if_missing(true)
            .foreign_keys(true)
    });
    let database = Database::connect(options)
        .await
        .expect("create Execution generation database");
    database
        .execute_unprepared(
            "CREATE TABLE worktracker_project (id char(32) PRIMARY KEY);\n\
             CREATE TABLE worktracker_issue (id char(32) PRIMARY KEY);\n\
             CREATE TABLE agent_runs (id varchar(255) PRIMARY KEY);\n\
             CREATE TABLE graph_runs (\n\
               root_id char(32) PRIMARY KEY REFERENCES worktracker_issue(id),\n\
               agent varchar(255), created_at datetime NOT NULL, updated_at datetime NOT NULL,\n\
               module_id char(32) REFERENCES worktracker_issue(id),\n\
               project_id char(32) NOT NULL REFERENCES worktracker_project(id),\n\
               execution_mode varchar(16) NOT NULL, launch_configuration text\n\
             );\n\
             CREATE TABLE launched_tasks (\n\
               task_id char(32) PRIMARY KEY REFERENCES worktracker_issue(id),\n\
               claim_id char(32) NOT NULL UNIQUE,\n\
               agent_run_id varchar(255) NOT NULL REFERENCES agent_runs(id),\n\
               launch_effect_id char(32) NOT NULL UNIQUE,\n\
               launch_generation integer NOT NULL CHECK (launch_generation > 0),\n\
               launched_at datetime NOT NULL,\n\
               root_id char(32) NOT NULL REFERENCES graph_runs(root_id)\n\
             );",
        )
        .await
        .expect("install Execution generation schema");
    database.close().await.expect("close generation database");
    println!("{}", output.display());
}
