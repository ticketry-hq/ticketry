use sea_orm::{ConnectionTrait, DbBackend, Statement};
use ticketry_installation::{install_final_schema_migrations, ORDERED_MIGRATION_IDS};

#[path = "../../../../tests/final_schema_migration_chain/support.rs"]
mod support;

#[tokio::test]
async fn installation_chain_reaches_sprints_and_preserves_backlog() {
    let (_directory, database) = support::fixture().await;
    install_final_schema_migrations(&database).await.unwrap();
    assert_eq!(ORDERED_MIGRATION_IDS.last(), Some(&"0063_sprints"));
    for table in [
        "worktracker_sprint",
        "worktracker_sprint_goal",
        "worktracker_sprint_suggestion",
    ] {
        assert!(
            support::table_exists(&database, table).await,
            "missing {table}"
        );
    }
    let assigned = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM worktracker_issue WHERE sprint_id IS NOT NULL"
                .to_owned(),
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(assigned.try_get::<i64>("", "count").unwrap(), 0);
    install_final_schema_migrations(&database).await.unwrap();
    support::assert_final(&database).await;
}
