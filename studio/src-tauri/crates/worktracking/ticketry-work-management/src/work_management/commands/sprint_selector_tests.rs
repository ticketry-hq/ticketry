use sea_orm::ConnectionTrait;

use super::controller_tests::{create, fixture, PROJECT};

async fn sprint_fixture() -> (tempfile::TempDir, sea_orm::DatabaseConnection) {
    let (directory, database) = fixture().await;
    database
        .execute_unprepared("CREATE TABLE agent_runs (id char(32) PRIMARY KEY)")
        .await
        .unwrap();
    let backend = database.get_database_backend();
    let table =
        sea_orm::Schema::new(backend).create_table_from_entity(ticketry_entities::sprint::Entity);
    database.execute_raw(backend.build(&table)).await.unwrap();
    database.execute_unprepared(&format!(
        "INSERT INTO worktracker_sprint (id, project_id, name, status, rank, created_at, updated_at)
         VALUES ('50000000000000000000000000000001', '{PROJECT}', 'Sprint one', 'active', 'V', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    )).await.unwrap();
    (directory, database)
}

#[tokio::test]
async fn sprint_selector_current_creates_a_task_in_the_active_sprint() {
    let (_directory, database) = sprint_fixture().await;
    let mut input = create("Current sprint task");
    input.sprint_id = Some(crate::SprintSelector::Current);
    let id = crate::create_work_item(&database, input, None)
        .await
        .unwrap();
    let revision = crate::work_item(&database, &id)
        .await
        .unwrap()
        .unwrap()
        .state_revision;
    crate::update_work_item_sprint(
        &database,
        &id,
        crate::PatchValue::Value(crate::SprintSelector::Explicit(
            "50000000-0000-0000-0000-000000000001".to_owned(),
        )),
        None,
    )
    .await
    .unwrap();
    let repeated = crate::work_item(&database, &id).await.unwrap().unwrap();
    assert_eq!(
        repeated.state_revision, revision,
        "Current must already assign the active sprint, so repeating its explicit ID is a no-op"
    );
}

#[tokio::test]
async fn sprint_selector_next_assigns_the_first_planned_sprint_on_create_and_update() {
    let (_directory, database) = sprint_fixture().await;
    database.execute_unprepared(&format!(
        "INSERT INTO worktracker_sprint (id, project_id, name, status, rank, created_at, updated_at) VALUES
         ('50000000000000000000000000000002', '{PROJECT}', 'Later planned', 'planned', 'Y', '2026-01-01 00:00:00', CURRENT_TIMESTAMP),
         ('50000000000000000000000000000003', '{PROJECT}', 'Next planned', 'planned', 'X', '2026-02-01 00:00:00', CURRENT_TIMESTAMP)"
    )).await.unwrap();

    for has_active_sprint in [true, false] {
        if !has_active_sprint {
            database
                .execute_unprepared(
                    "UPDATE worktracker_sprint SET status = 'completed' WHERE status = 'active'",
                )
                .await
                .unwrap();
        }
        let mut input = create("Next sprint task");
        input.sprint_id = Some(crate::SprintSelector::Next);
        let created = crate::create_work_item(&database, input, None)
            .await
            .unwrap();
        let existing = crate::create_work_item(&database, create("Move to next"), None)
            .await
            .unwrap();
        crate::update_work_item_sprint(
            &database,
            &existing,
            crate::PatchValue::Value(crate::SprintSelector::Next),
            None,
        )
        .await
        .unwrap();
        for id in [created, existing] {
            let revision = crate::work_item(&database, &id)
                .await
                .unwrap()
                .unwrap()
                .state_revision;
            crate::update_work_item_sprint(
                &database,
                &id,
                crate::PatchValue::Value(crate::SprintSelector::Explicit(
                    "50000000000000000000000000000003".to_owned(),
                )),
                None,
            )
            .await
            .unwrap();
            assert_eq!(
                crate::work_item(&database, &id)
                    .await
                    .unwrap()
                    .unwrap()
                    .state_revision,
                revision,
                "Next must already assign the first planned sprint, so its explicit ID is a no-op",
            );
        }
    }
}

#[tokio::test]
async fn sprint_selector_next_without_planned_sprints_rejects_atomically() {
    let (_directory, database) = sprint_fixture().await;
    let existing = crate::create_work_item(&database, create("Keep in backlog"), None)
        .await
        .unwrap();
    let revision = crate::work_item(&database, &existing)
        .await
        .unwrap()
        .unwrap()
        .state_revision;
    let mut input = create("Must not exist");
    input.sprint_id = Some(crate::SprintSelector::Next);
    let rejected_create = crate::create_work_item(&database, input, None)
        .await
        .unwrap_err();
    let rejected_update = crate::update_work_item_sprint(
        &database,
        &existing,
        crate::PatchValue::Value(crate::SprintSelector::Next),
        None,
    )
    .await
    .unwrap_err();
    for rejection in [rejected_create, rejected_update] {
        assert!(matches!(
            rejection,
            crate::CommandError::Rejected {
                code: "no_next_sprint",
                field: Some("sprint"),
                ..
            }
        ));
    }
    assert_eq!(
        crate::work_items(&database, Some(PROJECT), None, None)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        crate::work_item(&database, &existing)
            .await
            .unwrap()
            .unwrap()
            .state_revision,
        revision
    );
}

#[tokio::test]
async fn sprint_selector_rejections_preserve_created_and_existing_work_items() {
    let (_directory, database) = sprint_fixture().await;
    let id = crate::create_work_item(&database, create("Keep membership"), None)
        .await
        .unwrap();
    database.execute_unprepared(&format!(
        "INSERT INTO worktracker_project VALUES ('10000000000000000000000000000002', 'Foreign', 'FOR', '', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
         INSERT INTO worktracker_sprint (id, project_id, name, status, rank, created_at, updated_at) VALUES
         ('50000000000000000000000000000002', '{PROJECT}', 'Closed', 'completed', 'W', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
         ('50000000000000000000000000000003', '10000000000000000000000000000002', 'Foreign', 'planned', 'X', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    )).await.unwrap();
    let revision = crate::work_item(&database, &id)
        .await
        .unwrap()
        .unwrap()
        .state_revision;
    for (selector, code, field) in [
        (
            "50000000000000000000000000000002",
            "completed_sprint",
            Some("sprint"),
        ),
        (
            "50000000000000000000000000000003",
            "foreign_sprint",
            Some("sprint"),
        ),
        ("50000000000000000000000000000004", "not_found", None),
        ("malformed", "field_validation", Some("sprint")),
        ("next", "field_validation", Some("sprint")),
    ] {
        let selector = crate::SprintSelector::Explicit(selector.to_owned());
        let mut input = create("Must not exist");
        input.sprint_id = Some(selector.clone());
        let rejected = crate::create_work_item(&database, input, None)
            .await
            .unwrap_err();
        assert_eq!((rejected.code(), rejected.field_name()), (code, field));
        let rejected = crate::update_work_item_sprint(
            &database,
            &id,
            crate::PatchValue::Value(selector),
            None,
        )
        .await
        .unwrap_err();
        assert_eq!((rejected.code(), rejected.field_name()), (code, field));
        let existing = crate::work_item(&database, &id).await.unwrap().unwrap();
        assert_eq!(existing.state_revision, revision);
        assert_eq!(
            crate::work_items(&database, Some(PROJECT), None, None)
                .await
                .unwrap()
                .len(),
            1
        );
    }
}
