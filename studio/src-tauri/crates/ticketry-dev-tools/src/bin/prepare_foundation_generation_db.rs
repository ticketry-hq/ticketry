use sea_orm::{ConnectOptions, Database};
use sea_orm_migration::MigratorTrait;

use ticketry_graphql_schema::graphql_foundation::migrations::Migrator;

#[tokio::main]
async fn main() {
    let output = std::env::args_os()
        .nth(1)
        .map(std::path::PathBuf::from)
        .expect("usage: prepare_foundation_generation_db <output.sqlite3>");
    if output.exists() {
        std::fs::remove_file(&output).expect("remove prior generation database");
    }

    let database_path = output.clone();
    let mut options = ConnectOptions::new("sqlite:generation.sqlite3?mode=rwc");
    options.map_sqlx_sqlite_opts(move |options| {
        options
            .filename(&database_path)
            .create_if_missing(true)
            .foreign_keys(true)
    });
    let database = Database::connect(options)
        .await
        .expect("create the foundation generation database");
    Migrator::up(&database, None)
        .await
        .expect("apply foundation migrations");
    database.close().await.expect("close generation database");
    println!("{}", output.display());
}
