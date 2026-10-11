use sea_orm::{ConnectionTrait, DbBackend, Statement};
use ticketry_installation::{install_final_schema_migrations, ORDERED_MIGRATION_IDS};
use ticketry_work_management::install_sprint_schema;

#[path = "../../../../tests/final_schema_migration_chain/support.rs"]
mod support;

#[tokio::test]
async fn populated_sprints_backfill_history_then_active_then_planned_per_project() {
    let (_directory, database) = support::fixture().await;
    install_sprint_schema(&database).await.unwrap();
    database.execute_unprepared(
        "INSERT INTO worktracker_project
            (id,name,slug,description,seq_counter,created_at,updated_at,workspace_id,state_revision,manual_module_order)
            VALUES ('00000000000000000000000000002001','Other','OTH','',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'00000000000000000000000000001000',0,0);
         INSERT INTO worktracker_sprint
            (id,name,status,created_at,updated_at,project_id) VALUES
            ('other-planned-a','Other Planned Later','planned','2022-01-01','2022-01-01','00000000000000000000000000002001'),
            ('other-planned','Other Planned','planned','2020-01-01','2020-01-01','00000000000000000000000000002001'),
            ('other-completed','Other Completed','completed','2026-01-01','2026-01-01','00000000000000000000000000002001'),
            ('planned-z','Planned Z','planned','2026-01-01','2026-01-01','00000000000000000000000000001001'),
            ('completed-b','Completed B','completed','2026-02-01','2026-02-01','00000000000000000000000000001001'),
            ('active','Active','active','2025-01-01','2025-01-01','00000000000000000000000000001001'),
            ('completed-a','Completed A','completed','2026-03-01','2026-03-01','00000000000000000000000000001001'),
            ('planned-a','Planned A','planned','2026-01-01','2026-01-01','00000000000000000000000000001001');
         INSERT INTO worktracker_sprint_goal
            (id,sprint_id,position,text,created_at,updated_at)
            VALUES ('goal','planned-a',0,'Preserved','2026-01-01','2026-01-01');
         UPDATE worktracker_issue SET sprint_id='planned-a' WHERE id='00000000000000000000000000001006';",
    ).await.unwrap();
    install_final_schema_migrations(&database).await.unwrap();
    assert_eq!(ORDERED_MIGRATION_IDS.last(), Some(&"0065_sprint_rank"));
    let ranks = database.query_all_raw(Statement::from_string(
        DbBackend::Sqlite,
        "SELECT id,rank FROM worktracker_sprint WHERE project_id='00000000000000000000000000001001' ORDER BY rank ASC,id ASC".to_owned(),
    )).await.unwrap().into_iter().map(|row| (
        row.try_get::<String>("", "id").unwrap(),
        row.try_get::<String>("", "rank").unwrap(),
    )).collect::<Vec<_>>();
    assert_eq!(
        ranks.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
        [
            "completed-b",
            "completed-a",
            "active",
            "planned-a",
            "planned-z"
        ]
    );
    assert_eq!(
        ranks
            .iter()
            .map(|(_, rank)| rank.as_str())
            .collect::<Vec<_>>(),
        [
            "AKfKfKfKfKfKfKfKfKfK",
            "KfKfKfKfKfKfKfKfKfKf",
            "V",
            "fKfKfKfKfKfKfKfKfKfK",
            "pfKfKfKfKfKfKfKfKfKf"
        ]
    );
    let other = database.query_all_raw(Statement::from_string(DbBackend::Sqlite,
        "SELECT id,rank FROM worktracker_sprint WHERE project_id='00000000000000000000000000002001' ORDER BY rank,id".to_owned())).await.unwrap();
    assert_eq!(
        other
            .iter()
            .map(|row| row.try_get::<String>("", "id").unwrap())
            .collect::<Vec<_>>(),
        ["other-completed", "other-planned", "other-planned-a"]
    );
    assert_eq!(other[0].try_get::<String>("", "rank").unwrap(), "FV");
    assert_eq!(other[1].try_get::<String>("", "rank").unwrap(), "V");
    assert_eq!(other[2].try_get::<String>("", "rank").unwrap(), "kV");
    let rank_column = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(worktracker_sprint)".to_owned(),
        ))
        .await
        .unwrap()
        .into_iter()
        .find(|row| row.try_get::<String>("", "name").unwrap() == "rank")
        .unwrap();
    assert_eq!(rank_column.try_get::<i32>("", "notnull").unwrap(), 1);
    assert!(database
        .execute_unprepared("UPDATE worktracker_sprint SET rank=NULL WHERE id='active'")
        .await
        .is_err());
    let preserved = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT sprint_id FROM worktracker_issue WHERE id='00000000000000000000000000001006'"
                .to_owned(),
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        preserved.try_get::<String>("", "sprint_id").unwrap(),
        "planned-a"
    );
    database
        .execute_unprepared("UPDATE worktracker_sprint SET rank='z' WHERE id='planned-z'")
        .await
        .unwrap();
    install_final_schema_migrations(&database).await.unwrap();
    assert_eq!(
        database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT rank FROM worktracker_sprint WHERE id='planned-z'".to_owned()
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get::<String>("", "rank")
            .unwrap(),
        "z"
    );
    assert_eq!(
        database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT text FROM worktracker_sprint_goal WHERE id='goal'".to_owned()
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get::<String>("", "text")
            .unwrap(),
        "Preserved"
    );
    assert!(database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA foreign_key_check".to_owned()
        ))
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn failed_sprint_backfill_rolls_back_column_and_ledger() {
    let (_directory, database) = support::fixture().await;
    install_sprint_schema(&database).await.unwrap();
    database.execute_unprepared(
        "INSERT INTO worktracker_sprint (id,name,status,created_at,updated_at,project_id)
         VALUES ('sprint','Sprint','planned','2026-01-01','2026-01-01','00000000000000000000000000001001');
         CREATE TRIGGER reject_rank BEFORE UPDATE ON worktracker_sprint BEGIN
             SELECT RAISE(ABORT,'injected backfill failure');
         END;"
    ).await.unwrap();
    assert!(install_final_schema_migrations(&database)
        .await
        .unwrap_err()
        .to_string()
        .contains("injected backfill failure"));
    assert!(!support::table_exists(&database, "ticketry_sprint_rank_migration").await);
    let columns = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(worktracker_sprint)".to_owned(),
        ))
        .await
        .unwrap();
    assert!(!columns
        .iter()
        .any(|row| row.try_get::<String>("", "name").unwrap() == "rank"));
    database
        .execute_unprepared("DROP TRIGGER reject_rank")
        .await
        .unwrap();
    install_final_schema_migrations(&database).await.unwrap();
}
