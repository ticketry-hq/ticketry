use std::collections::{BTreeMap, BTreeSet};

use muxed_studio_lib::{
    installation::adoption::provisioning,
    settings_persistence::provider_catalog_migrations,
    work_management::{
        launch_binding_entry_skill_migration, module_presentation_migration, open_for_commands,
        project_onboarding_migration, workflow_color_migration, workspace_tab_order_migration,
    },
    worktree::persistence::pull_request_url_migration,
};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

const PROJECT: &str = "00000000000000000000000000001001";
const GRILL: &str = "00000000000000000000000000001002";
const STORY: &str = "00000000000000000000000000001003";
const ACTIVE_MODULE: &str = "00000000000000000000000000001004";
const ARCHIVED_MODULE: &str = "00000000000000000000000000001005";
const TASK: &str = "00000000000000000000000000001006";

pub async fn fixture() -> (tempfile::TempDir, DatabaseConnection) {
    let directory = tempfile::tempdir().expect("create 0043 fixture directory");
    provisioning::provision(directory.path())
        .await
        .expect("provision the generated 0043 schema");
    let database = open_for_commands(&directory.path().join("state.db"))
        .await
        .expect("open the 0043 fixture");
    database
        .execute_unprepared(&format!(
            "PRAGMA foreign_keys = ON;
             UPDATE worktracker_project
                SET id='{PROJECT}', manual_module_order=1
              WHERE slug='CDN';
             INSERT INTO worktracker_state
                (id,name,\"group\",color,created_at,updated_at,project_id,sort_order,is_protected)
             VALUES
                ('{GRILL}','Grill','backlog','#60646C',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'{PROJECT}',1,0),
                ('00000000000000000000000000001007','Ideas','backlog','#D12771',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'{PROJECT}',2,0),
                ('00000000000000000000000000001008','Review','started','#D6409F',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'{PROJECT}',3,0);
             INSERT INTO worktracker_issuetype
                (id,name,level,color,sort_order,created_at,updated_at,project_id,
                 start_state_id,workflow_revision,is_pathfind)
             VALUES ('{STORY}','Story','task','',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
                     '{PROJECT}','{GRILL}',1,0);
             INSERT INTO worktracker_launchbinding
                (prompt,created_at,updated_at,issue_type_id,state_id,auto_start,
                 subtree_run_enabled,required_skills,model_id,reasoning_id)
             VALUES ('Grill it',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'{STORY}','{GRILL}',0,0,
                     '[\"grill-with-docs\"]',NULL,NULL);
             INSERT INTO worktracker_issue
                (id,type,name,sequence_id,description,created_at,updated_at,project_id,state_id,
                 is_archived,rank,state_revision,issue_type_id,parent_id,module_id)
             VALUES
                ('{ACTIVE_MODULE}','module','Active module',1,'kept',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
                 '{PROJECT}',NULL,0,'A',0,'{STORY}',NULL,NULL),
                ('{ARCHIVED_MODULE}','module','Archived module',2,'kept',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
                 '{PROJECT}',NULL,1,'B',0,'{STORY}',NULL,NULL),
                ('{TASK}','task','Preserved task',3,'kept',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
                 '{PROJECT}','{GRILL}',0,'C',7,'{STORY}','{ACTIVE_MODULE}','{ACTIVE_MODULE}');"
        ))
        .await
        .expect("seed preserved 0043 rows");
    (directory, database)
}

pub async fn table_exists(database: &DatabaseConnection, table: &str) -> bool {
    database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap()
        == 1
}

async fn column_names(database: &DatabaseConnection, table: &str) -> Vec<String> {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("PRAGMA table_info({table})"),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").unwrap())
        .collect()
}

pub async fn assert_final(database: &DatabaseConnection) {
    assert!(!table_exists(database, "worktracker_workspace").await);
    let project = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT onboarding_required FROM worktracker_project WHERE id='{PROJECT}'"),
        ))
        .await
        .unwrap()
        .unwrap();
    assert!(project.try_get::<bool>("", "onboarding_required").unwrap());
    let project_columns = column_names(database, "worktracker_project").await;
    assert!(!project_columns.iter().any(|name| name == "workspace_id"));
    assert!(!project_columns
        .iter()
        .any(|name| name == "manual_module_order"));

    let issue_columns = column_names(database, "worktracker_issue").await;
    assert!(issue_columns
        .iter()
        .any(|name| name == "workspace_tab_order"));

    let binding = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT entry_skill FROM worktracker_launchbinding".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        binding.try_get::<String>("", "entry_skill").unwrap(),
        "grill-with-docs"
    );

    let colors = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name,color FROM worktracker_state ORDER BY name".to_owned(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| {
            (
                row.try_get::<String>("", "name").unwrap(),
                row.try_get::<String>("", "color").unwrap(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    assert_eq!(colors["Ideas"], "#60646C");
    assert_eq!(colors["Grill"], "#FA4D56");
    assert_eq!(colors["Review"], "#08BDBA");

    let presentations = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT module_id,rank FROM worktracker_modulepresentation ORDER BY rank".to_owned(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| {
            (
                row.try_get::<String>("", "module_id").unwrap(),
                row.try_get::<String>("", "rank").unwrap(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        presentations,
        vec![
            (ACTIVE_MODULE.to_owned(), "A".to_owned()),
            (ARCHIVED_MODULE.to_owned(), "B".to_owned()),
        ]
    );

    let catalog = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT model.name,reasoning.name AS reasoning
             FROM worktracker_agentmodel model
             JOIN worktracker_provider provider ON provider.id=model.provider_id
             LEFT JOIN worktracker_agentmodelreasoninglevel link ON link.agent_model_id=model.id
             LEFT JOIN worktracker_reasoninglevel reasoning ON reasoning.id=link.reasoning_level_id
             WHERE provider.slug='codex' AND (model.name LIKE 'gpt-5.6-%' OR model.name='gpt-5.3-codex-spark')
             ORDER BY model.name,reasoning.name"
                .to_owned(),
        ))
        .await
        .unwrap();
    let mut matrix = BTreeMap::<String, Vec<String>>::new();
    for row in catalog {
        matrix
            .entry(row.try_get("", "name").unwrap())
            .or_default()
            .extend(row.try_get::<Option<String>>("", "reasoning").unwrap());
    }
    assert_eq!(matrix["gpt-5.3-codex-spark"], Vec::<String>::new());
    assert_eq!(
        matrix["gpt-5.6-luna"]
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["low", "medium", "high", "xhigh", "max"])
    );
    let full_reasoning = BTreeSet::from(["low", "medium", "high", "xhigh", "max", "ultra"]);
    for model in ["gpt-5.6-sol", "gpt-5.6-terra"] {
        assert_eq!(
            matrix[model]
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            full_reasoning
        );
    }

    let task = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT name,description,rank,state_revision,parent_id,module_id,workspace_tab_order
                 FROM worktracker_issue WHERE id='{TASK}'"
            ),
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        task.try_get::<String>("", "name").unwrap(),
        "Preserved task"
    );
    assert_eq!(task.try_get::<String>("", "description").unwrap(), "kept");
    assert_eq!(task.try_get::<String>("", "rank").unwrap(), "C");
    assert_eq!(task.try_get::<i64>("", "state_revision").unwrap(), 7);
    assert_eq!(
        task.try_get::<String>("", "parent_id").unwrap(),
        ACTIVE_MODULE
    );
    assert_eq!(
        task.try_get::<String>("", "module_id").unwrap(),
        ACTIVE_MODULE
    );
    assert_eq!(
        task.try_get::<serde_json::Value>("", "workspace_tab_order")
            .unwrap(),
        serde_json::json!([])
    );

    for (table, expected_id) in [
        (
            provider_catalog_migrations::CODEX_5_6_LEDGER,
            provider_catalog_migrations::CODEX_5_6_MIGRATION_ID,
        ),
        (
            project_onboarding_migration::LEDGER_TABLE,
            project_onboarding_migration::MIGRATION_ID,
        ),
        (
            launch_binding_entry_skill_migration::LEDGER_TABLE,
            launch_binding_entry_skill_migration::MIGRATION_ID,
        ),
        (
            workflow_color_migration::LEDGER_TABLE,
            workflow_color_migration::MIGRATION_ID,
        ),
        (
            workspace_tab_order_migration::LEDGER_TABLE,
            workspace_tab_order_migration::MIGRATION_ID,
        ),
        (
            module_presentation_migration::LEDGER_TABLE,
            module_presentation_migration::MIGRATION_ID,
        ),
        (
            provider_catalog_migrations::CODEX_SPARK_LEDGER,
            provider_catalog_migrations::CODEX_SPARK_MIGRATION_ID,
        ),
        (
            pull_request_url_migration::LEDGER_TABLE,
            pull_request_url_migration::MIGRATION_ID,
        ),
    ] {
        let row = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("SELECT migration_id FROM {table}"),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.try_get::<String>("", "migration_id").unwrap(),
            expected_id
        );
    }

    assert!(database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA foreign_key_check".to_owned(),
        ))
        .await
        .unwrap()
        .is_empty());
}
