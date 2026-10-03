use super::{create, snapshot::Snapshot, SprintSuggestionExecutor};
use sea_orm::{
    ActiveModelTrait, ConnectionTrait, Database, DatabaseConnection, DbBackend, Schema, Set,
    TransactionTrait,
};
use ticketry_entities::{
    agent_execution, agent_run, app_settings, issue, issue_type, project, provider, sprint,
    sprint_goal, sprint_suggestion, state,
};

pub(super) const PROJECT: &str = "20000000000000000000000000000001";
pub(super) const SPRINT: &str = "10000000000000000000000000000001";
pub(super) const GOAL: &str = "30000000000000000000000000000001";
pub(super) const STORY: &str = "50000000000000000000000000000001";
pub(super) const MODULE: &str = "50000000000000000000000000000002";

pub(super) async fn fixture() -> (DatabaseConnection, tempfile::TempDir) {
    let db = Database::connect("sqlite::memory:").await.unwrap();
    db.execute_unprepared("PRAGMA foreign_keys=OFF")
        .await
        .unwrap();
    let ddl = Schema::new(DbBackend::Sqlite);
    for table in [
        ddl.create_table_from_entity(project::Entity),
        ddl.create_table_from_entity(issue::Entity),
        ddl.create_table_from_entity(issue_type::Entity),
        ddl.create_table_from_entity(state::Entity),
        ddl.create_table_from_entity(sprint::Entity),
        ddl.create_table_from_entity(sprint_goal::Entity),
        ddl.create_table_from_entity(sprint_suggestion::Entity),
        ddl.create_table_from_entity(agent_run::Entity),
        ddl.create_table_from_entity(app_settings::Entity),
        ddl.create_table_from_entity(provider::Entity),
    ] {
        db.execute_raw(DbBackend::Sqlite.build(&table))
            .await
            .unwrap();
    }
    ticketry_work_management::install_sprint_execution_schema(&db)
        .await
        .unwrap();
    ticketry_work_management::install_sprint_execution_schema(&db)
        .await
        .unwrap();
    db.execute_unprepared("INSERT INTO worktracker_project
        (id,name,slug,description,seq_counter,state_revision,created_at,updated_at,onboarding_required) VALUES
        ('20000000000000000000000000000001','Project','project','',2,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0);
        INSERT INTO worktracker_issuetype (id,project_id,name,level,color,sort_order,start_state_id,workflow_revision,is_pathfind,created_at,updated_at) VALUES
        ('70000000000000000000000000000001','20000000000000000000000000000001','Story','task','',1,NULL,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO worktracker_sprint (id,project_id,name,status,created_at,updated_at) VALUES
        ('10000000000000000000000000000001','20000000000000000000000000000001','Sprint','planned',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO worktracker_sprint_goal (id,sprint_id,position,text,created_at,updated_at) VALUES
        ('30000000000000000000000000000001','10000000000000000000000000000001',1,'Ship planning',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO worktracker_issue (id,project_id,type,issue_type_id,state_revision,name,sequence_id,is_archived,rank,description,workspace_tab_order,created_at,updated_at) VALUES
        ('50000000000000000000000000000001','20000000000000000000000000000001','task','70000000000000000000000000000001',1,'Existing story',1,0,'A','','[]',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
        ('50000000000000000000000000000002','20000000000000000000000000000001','module','70000000000000000000000000000001',1,'Epic',2,0,'','','[]',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);").await.unwrap();
    provider::ActiveModel {
        id: Set("codex".into()),
        supports_unattended: Set(true),
        slug: Set("codex".into()),
        activated: Set(true),
        ..Default::default()
    }
    .insert(&db)
    .await
    .unwrap();
    app_settings::ActiveModel { scope: Set("host".into()), key: Set("provider_catalog".into()),
        value: Set(r#"{"global_default":{"provider":"codex","profile":null,"model":null,"reasoning":null}}"#.into()),
        updated_at: Set(chrono::Utc::now().to_rfc3339()) }.insert(&db).await.unwrap();
    (db, tempfile::tempdir().unwrap())
}
pub(super) async fn running(
    db: &DatabaseConnection,
    directory: &std::path::Path,
) -> (SprintSuggestionExecutor, agent_execution::Model, Snapshot) {
    let txn = db.begin().await.unwrap();
    let mut active = create::prepare(&txn, PROJECT, SPRINT, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap();
    active.state = Set("running".into());
    let job = active.insert(&txn).await.unwrap();
    txn.commit().await.unwrap();
    let snapshot = serde_json::from_str(&job.input_snapshot).unwrap();
    (
        SprintSuggestionExecutor::new(db.clone(), directory.to_owned()),
        job,
        snapshot,
    )
}
