use sea_orm::{ConnectOptions, ConnectionTrait, Database};

#[tokio::main]
async fn main() {
    let output = std::env::args_os()
        .nth(1)
        .map(std::path::PathBuf::from)
        .expect("usage: prepare_sprint_generation_db <output.sqlite3>");
    if output.exists() {
        std::fs::remove_file(&output).expect("remove prior generation database");
    }
    let database_path = output.clone();
    let mut options = ConnectOptions::new("sqlite:sprint-generation.sqlite3?mode=rwc");
    options
        .max_connections(1)
        .map_sqlx_sqlite_opts(move |options| {
            options
                .filename(&database_path)
                .create_if_missing(true)
                .foreign_keys(true)
        });
    let database = Database::connect(options)
        .await
        .expect("create sprint generation database");
    database
        .execute_unprepared(
            "CREATE TABLE worktracker_project (id char(32) PRIMARY KEY);
         CREATE TABLE worktracker_issue (id char(32) PRIMARY KEY);
         CREATE TABLE agent_runs (id varchar(255) PRIMARY KEY);",
        )
        .await
        .expect("create referenced generation tables");
    ticketry_work_management::install_sprint_schema(&database)
        .await
        .expect("install sprint schema");
    ticketry_work_management::install_sprint_rank_schema(&database)
        .await
        .expect("install sprint rank schema");
    database.close().await.expect("close generation database");
    println!("{}", output.display());
}
