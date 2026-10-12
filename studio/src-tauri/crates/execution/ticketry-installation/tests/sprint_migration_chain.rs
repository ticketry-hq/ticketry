use sea_orm::{ConnectionTrait, DbBackend, Statement};
use ticketry_installation::{install_final_schema_migrations, ORDERED_MIGRATION_IDS};

#[path = "../../../../tests/final_schema_migration_chain/support.rs"]
mod support;

#[tokio::test]
async fn installation_chain_reaches_sprints_and_preserves_backlog() {
    let (_directory, database) = support::fixture().await;
    install_final_schema_migrations(&database).await.unwrap();
    support::sprint_acceptance::assert_sprint_history(&ORDERED_MIGRATION_IDS);
    support::sprint_acceptance::assert_sprint_schema_and_ledger(&database).await;
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

#[test]
fn sprint_history_tolerates_an_appended_catalog_migration() {
    let mut appended = ORDERED_MIGRATION_IDS.clone();
    appended.push("0065_acceptance_appended_catalog");
    support::sprint_acceptance::assert_sprint_history(&appended);
}

#[test]
#[should_panic(expected = "0063_sprints")]
fn sprint_history_rejects_a_chain_without_sprints() {
    let missing: Vec<_> = ORDERED_MIGRATION_IDS
        .iter()
        .copied()
        .filter(|id| *id != "0063_sprints")
        .collect();
    support::sprint_acceptance::assert_sprint_history(&missing);
}

#[test]
#[should_panic(expected = "0063_sprints")]
fn sprint_history_rejects_sprints_out_of_historical_order() {
    let mut reordered = ORDERED_MIGRATION_IDS.clone();
    let sprints = reordered.iter().position(|id| *id == "0063_sprints").unwrap();
    reordered.swap(sprints - 1, sprints);
    support::sprint_acceptance::assert_sprint_history(&reordered);
}
