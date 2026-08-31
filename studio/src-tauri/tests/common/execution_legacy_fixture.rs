//! Static historical execution stores used only by adoption tests.
//!
//! The checked schema and migration-ledger artifacts describe the last shipped
//! Django installation. Older execution leaves are reconstructed from fixed DDL
//! while every surrounding capability remains at that shipped leaf, matching the
//! old fixture's migrate-all-then-rewind-execution behavior. No Python runtime is
//! needed to materialize the stores during a test.
#![allow(dead_code)]

use std::path::Path;

use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};

pub const CURRENT_LEAF: &str = "0007_graph_run_launch_configuration";
pub const LEAVES: &[&str] = &[
    "0001_initial",
    "0002_graphrun",
    "0003_nullable_agent_override",
    "0004_remove_enginerun_phase",
    "0005_launchedtask_delete_enginerun",
    "0006_graphrun_execution_mode",
    CURRENT_LEAF,
];

pub const PROJECT: &str = "00000000000000000000000000089301";
pub const MODULE: &str = "00000000000000000000000000089305";
pub const SERIAL_ROOT: &str = "00000000000000000000000000089306";
pub const CLAIMED_CHILD: &str = "00000000000000000000000000089307";
pub const PARALLEL_ROOT: &str = "00000000000000000000000000089309";
pub const CLAIMED_AGENT_RUN: &str = "run-893";
pub const CLAIMED_LAUNCHED_AT: &str = "2026-08-19 17:30:00";

const CURRENT_SCHEMA: &str =
    include_str!("../../crates/ticketry-installation/src/adoption/provisioning.v1.sql");
const CURRENT_LEDGER: &str =
    include_str!("../../crates/ticketry-installation/src/adoption/provisioning-ledger.v1.sql");

pub async fn migrate_leaf(data_directory: &Path, leaf: &str) {
    let database = install_current_shape(data_directory).await;
    rebuild_execution_leaf(&database, leaf).await;
    database
        .close()
        .await
        .expect("close execution leaf fixture");
}

pub async fn provision_current(data_directory: &Path) {
    let database = install_current_shape(data_directory).await;
    database
        .execute_unprepared(SEEDED_CURRENT_LEAF)
        .await
        .expect("seed the historical execution fixture");
    database
        .close()
        .await
        .expect("close historical execution fixture");
}

pub async fn mutate(data_directory: &Path, sql: &str) {
    let database = open(data_directory, "rw").await;
    database
        .execute_unprepared(sql)
        .await
        .expect("apply historical execution fixture mutation");
    database
        .close()
        .await
        .expect("close mutated execution fixture");
}

async fn install_current_shape(data_directory: &Path) -> DatabaseConnection {
    let database = open(data_directory, "rwc").await;
    database
        .execute_unprepared(CURRENT_SCHEMA)
        .await
        .expect("apply the checked current installation schema");
    database
        .execute_unprepared(CURRENT_LEDGER)
        .await
        .expect("apply the checked current migration ledger");
    database
}

async fn open(data_directory: &Path, mode: &str) -> DatabaseConnection {
    Database::connect(format!(
        "sqlite:{}?mode={mode}",
        data_directory.join("state.db").display()
    ))
    .await
    .expect("open historical execution fixture")
}

async fn rebuild_execution_leaf(database: &DatabaseConnection, leaf: &str) {
    let generation = LEAVES
        .iter()
        .position(|candidate| *candidate == leaf)
        .map(|index| index + 1)
        .unwrap_or_else(|| panic!("unknown historical execution leaf {leaf}"));
    if generation == LEAVES.len() {
        return;
    }

    database
        .execute_unprepared(
            "PRAGMA foreign_keys=OFF; \
             DROP TABLE IF EXISTS launched_tasks; \
             DROP TABLE IF EXISTS launch_policy_effects; \
             DROP TABLE IF EXISTS graph_runs; \
             DROP TABLE IF EXISTS engine_runs; \
             DELETE FROM django_migrations WHERE app='execution';",
        )
        .await
        .expect("rewind the current execution schema");

    if generation <= 4 {
        database
            .execute_unprepared(if generation <= 3 {
                ENGINE_RUN_WITH_PHASE
            } else {
                ENGINE_RUN_WITHOUT_PHASE
            })
            .await
            .expect("create the historical engine run table");
    }
    if generation >= 2 {
        database
            .execute_unprepared(if generation >= 7 {
                GRAPH_RUN_LEAF_7
            } else if generation >= 6 {
                GRAPH_RUN_LEAF_6
            } else {
                GRAPH_RUN_LEAF_2
            })
            .await
            .expect("create the historical graph run table");
    }
    if generation >= 5 {
        database
            .execute_unprepared(LAUNCHED_TASKS_LEAF_5)
            .await
            .expect("create the historical launch ledger");
    }
    if generation >= 7 {
        database
            .execute_unprepared(LAUNCH_POLICY_EFFECTS_LEAF_7)
            .await
            .expect("create the historical policy receipt table");
    }

    for migration in &LEAVES[..generation] {
        database
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "INSERT INTO django_migrations (app,name,applied) VALUES ('execution', ?, '2026-08-19 17:00:00')",
                [(*migration).into()],
            ))
            .await
            .expect("record the historical execution leaf");
    }
    database
        .execute_unprepared("PRAGMA foreign_keys=ON")
        .await
        .expect("restore fixture foreign keys");
}

const ENGINE_RUN_WITH_PHASE: &str = r#"
CREATE TABLE engine_runs (
    task_id char(32) NOT NULL PRIMARY KEY REFERENCES worktracker_issue(id),
    agent varchar(255) NULL,
    phase varchar(50) NOT NULL,
    status varchar(50) NOT NULL,
    agent_run_id varchar(255) NULL,
    error text NULL,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    module_id char(32) NULL REFERENCES worktracker_issue(id),
    project_id char(32) NOT NULL REFERENCES worktracker_project(id)
);
"#;

const ENGINE_RUN_WITHOUT_PHASE: &str = r#"
CREATE TABLE engine_runs (
    task_id char(32) NOT NULL PRIMARY KEY REFERENCES worktracker_issue(id),
    agent varchar(255) NULL,
    status varchar(50) NOT NULL,
    agent_run_id varchar(255) NULL,
    error text NULL,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    module_id char(32) NULL REFERENCES worktracker_issue(id),
    project_id char(32) NOT NULL REFERENCES worktracker_project(id)
);
"#;

const GRAPH_RUN_LEAF_2: &str = r#"
CREATE TABLE graph_runs (
    root_id char(32) NOT NULL PRIMARY KEY REFERENCES worktracker_issue(id),
    agent varchar(255) NULL,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    module_id char(32) NULL REFERENCES worktracker_issue(id),
    project_id char(32) NOT NULL REFERENCES worktracker_project(id)
);
"#;

const GRAPH_RUN_LEAF_6: &str = r#"
CREATE TABLE graph_runs (
    root_id char(32) NOT NULL PRIMARY KEY REFERENCES worktracker_issue(id),
    agent varchar(255) NULL,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    module_id char(32) NULL REFERENCES worktracker_issue(id),
    project_id char(32) NOT NULL REFERENCES worktracker_project(id),
    execution_mode varchar(16) NOT NULL
);
"#;

const GRAPH_RUN_LEAF_7: &str = r#"
CREATE TABLE graph_runs (
    root_id char(32) NOT NULL PRIMARY KEY REFERENCES worktracker_issue(id),
    agent varchar(255) NULL,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    module_id char(32) NULL REFERENCES worktracker_issue(id),
    project_id char(32) NOT NULL REFERENCES worktracker_project(id),
    execution_mode varchar(16) NOT NULL,
    launch_configuration text NULL CHECK (json_valid(launch_configuration) OR launch_configuration IS NULL)
);
"#;

const LAUNCHED_TASKS_LEAF_5: &str = r#"
CREATE TABLE launched_tasks (
    task_id char(32) NOT NULL PRIMARY KEY REFERENCES worktracker_issue(id),
    agent_run_id varchar(255) NOT NULL,
    launched_at datetime NOT NULL,
    root_id char(32) NOT NULL REFERENCES worktracker_issue(id)
);
CREATE INDEX launched_tasks_root_id_8d9455d7 ON launched_tasks(root_id);
"#;

const LAUNCH_POLICY_EFFECTS_LEAF_7: &str = r#"
CREATE TABLE launch_policy_effects (
    decision_id varchar(32) NOT NULL PRIMARY KEY,
    caller_scope varchar(32) NOT NULL,
    idempotency_key varchar(255) NOT NULL,
    result text NULL CHECK (json_valid(result) OR result IS NULL),
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    CONSTRAINT uniq_launch_policy_effect_identity UNIQUE (caller_scope,idempotency_key)
);
"#;

const SEEDED_CURRENT_LEAF: &str = r#"
INSERT INTO worktracker_workspace
    (id,slug,name,created_at,updated_at,onboarding_required)
VALUES
    ('00000000000000000000000000089300','execution-adoption','Execution Adoption','2026-08-19 17:00:00','2026-08-19 17:00:00',0);
INSERT INTO worktracker_project
    (id,name,slug,description,seq_counter,created_at,updated_at,workspace_id,state_revision,manual_module_order)
VALUES
    ('00000000000000000000000000089301','Execution Adoption','T893','',1000,'2026-08-19 17:00:00','2026-08-19 17:00:00','00000000000000000000000000089300',0,0);
INSERT INTO worktracker_state
    (id,name,"group",color,created_at,updated_at,project_id,sort_order,is_protected)
VALUES
    ('00000000000000000000000000089302','Todo','unstarted','#4589FF','2026-08-19 17:00:00','2026-08-19 17:00:00','00000000000000000000000000089301',1,0);
INSERT INTO worktracker_issuetype
    (id,name,level,color,sort_order,created_at,updated_at,project_id,start_state_id,workflow_revision,is_pathfind)
VALUES
    ('00000000000000000000000000089303','Module','module','',1,'2026-08-19 17:00:00','2026-08-19 17:00:00','00000000000000000000000000089301','00000000000000000000000000089302',0,0),
    ('00000000000000000000000000089304','Implementation','task','',2,'2026-08-19 17:00:00','2026-08-19 17:00:00','00000000000000000000000000089301','00000000000000000000000000089302',0,0);
INSERT INTO worktracker_issue
    (id,type,name,sequence_id,description,created_at,updated_at,project_id,state_id,is_archived,rank,state_revision,issue_type_id,parent_id,module_id)
VALUES
    ('00000000000000000000000000089305','module','Module',891,'','2026-08-19 17:00:00','2026-08-19 17:00:00','00000000000000000000000000089301','00000000000000000000000000089302',0,'a',0,'00000000000000000000000000089303',NULL,NULL),
    ('00000000000000000000000000089306','task','Root',892,'','2026-08-19 17:00:00','2026-08-19 17:00:00','00000000000000000000000000089301','00000000000000000000000000089302',0,'b',0,'00000000000000000000000000089304','00000000000000000000000000089305','00000000000000000000000000089305'),
    ('00000000000000000000000000089307','task','Child',893,'','2026-08-19 17:00:00','2026-08-19 17:00:00','00000000000000000000000000089301','00000000000000000000000000089302',0,'c',0,'00000000000000000000000000089304','00000000000000000000000000089306','00000000000000000000000000089305'),
    ('00000000000000000000000000089309','task','Parallel Root',894,'','2026-08-19 17:00:00','2026-08-19 17:00:00','00000000000000000000000000089301','00000000000000000000000000089302',0,'d',0,'00000000000000000000000000089304','00000000000000000000000000089305','00000000000000000000000000089305'),
    ('00000000000000000000000000089310','task','Parallel Child',895,'','2026-08-19 17:00:00','2026-08-19 17:00:00','00000000000000000000000000089301','00000000000000000000000000089302',0,'e',0,'00000000000000000000000000089304','00000000000000000000000000089309','00000000000000000000000000089305');

INSERT INTO worktracker_provider (id,slug,activated,supports_unattended) VALUES
    ('00000000000000000000000000089380','agy',0,1),
    ('00000000000000000000000000089381','claude',1,1),
    ('00000000000000000000000000089382','codex',1,1),
    ('00000000000000000000000000089383','gemini',1,1);
INSERT INTO worktracker_agentmodel (id,name,provider_id) VALUES
    ('00000000000000000000000000089371','slice6-model','00000000000000000000000000089382');

INSERT INTO agent_runs
    (id,ticket_seq,status,started_at,ended_at,cwd,lifecycle_state,lifecycle_updated_at,scope,issue_id,agent)
VALUES
    ('run-893',893,'completed','2026-08-19 12:30:00','2026-08-19 12:45:00','/tmp','working','2026-08-19 12:45:00','task','00000000000000000000000000089307','codex');
INSERT INTO graph_runs
    (root_id,project_id,module_id,agent,execution_mode,launch_configuration,created_at,updated_at)
VALUES
    ('00000000000000000000000000089306','00000000000000000000000000089301','00000000000000000000000000089305','codex','serial','{"prompt":"implement","agent":"codex","model":null,"reasoning":null,"required_skills":[],"policy_version":1}','2026-08-19 17:00:00','2026-08-19 18:00:00'),
    ('00000000000000000000000000089309','00000000000000000000000000089301','00000000000000000000000000089305',NULL,'parallel',NULL,'2026-08-19 17:00:00','2026-08-19 17:00:00');
INSERT INTO launched_tasks (task_id,root_id,agent_run_id,launched_at) VALUES
    ('00000000000000000000000000089307','00000000000000000000000000089306','run-893','2026-08-19 17:30:00');
INSERT INTO launch_policy_effects
    (decision_id,caller_scope,idempotency_key,result,created_at,updated_at)
VALUES
    ('00000000000000000000000000089308','graph','root-893',NULL,'2026-08-19 17:00:00','2026-08-19 17:00:00');
"#;
