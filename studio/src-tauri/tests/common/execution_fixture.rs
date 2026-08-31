//! Current Rust-owned campaign data for the execution harness.
//!
//! The harness first lets the desktop composition provision and adopt an empty
//! installation. This module then inserts deterministic baseline facts through
//! the current SeaORM entities, before MCP, Terminal, and execution runtimes
//! start. It does not describe or recreate a historical Django installation.
#![allow(dead_code)]

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, Set, TransactionTrait,
};
use ticketry_entities::work_management::{
    agent_model, issue, issue_blocker, issue_type, issue_type_transition, launch_binding, project,
    provider, state,
};

pub const CAMPAIGN_PROJECT: &str = "00000000000000000000000000090301";
pub const CAMPAIGN_MODULE: &str = "00000000000000000000000000090305";
pub const PARALLEL_CAMPAIGN_ROOT: &str = "00000000000000000000000000090330";
pub const READY_FIRST: &str = "00000000000000000000000000090331";
pub const READY_SECOND: &str = "00000000000000000000000000090332";
pub const EXTERNALLY_BLOCKED: &str = "00000000000000000000000000090333";
pub const ARCHIVED_CHILD: &str = "00000000000000000000000000090334";
pub const GRANDCHILD: &str = "00000000000000000000000000090335";

pub const SERIAL_CAMPAIGN_ROOT: &str = "00000000000000000000000000090340";
pub const SERIAL_FIRST: &str = "00000000000000000000000000090341";
pub const SERIAL_SECOND: &str = "00000000000000000000000000090342";

pub const OUTSIDE_BLOCKER: &str = "00000000000000000000000000090350";
pub const CHILDLESS_ROOT: &str = "00000000000000000000000000090360";

pub const FOREIGN_PROJECT: &str = "00000000000000000000000000090401";
pub const FOREIGN_MODULE: &str = "00000000000000000000000000090405";
pub const FOREIGN_ROOT: &str = "00000000000000000000000000090430";

const TODO: &str = "00000000000000000000000000090310";
const IMPLEMENT: &str = "00000000000000000000000000090311";
const REVIEW: &str = "00000000000000000000000000090312";
const DONE: &str = "00000000000000000000000000090313";
const MODULE_TYPE: &str = "00000000000000000000000000090320";
const TASK_TYPE: &str = "00000000000000000000000000090321";

const FOREIGN_TODO: &str = "00000000000000000000000000090410";
const FOREIGN_MODULE_TYPE: &str = "00000000000000000000000000090420";
const FOREIGN_TASK_TYPE: &str = "00000000000000000000000000090421";

pub async fn seed_campaign(database: &DatabaseConnection) {
    let codex = provider::Entity::find()
        .filter(provider::Column::Slug.eq("codex"))
        .one(database)
        .await
        .expect("read the provisioned Codex provider")
        .expect("a fresh Rust installation provisions Codex");
    assert!(
        codex.activated,
        "the disposable provider needs an active adapter"
    );
    let model = agent_model::Entity::find()
        .filter(agent_model::Column::ProviderId.eq(&codex.id))
        .filter(agent_model::Column::Name.eq("gpt-5.4"))
        .one(database)
        .await
        .expect("read the provisioned Codex model")
        .expect("a fresh Rust installation provisions its Codex model");

    let transaction = database.begin().await.expect("start campaign fixture");
    let now = chrono::DateTime::parse_from_rfc3339("2026-08-19T17:00:00Z")
        .expect("fixture timestamp")
        .naive_utc();

    for (id, name, slug) in [
        (CAMPAIGN_PROJECT, "Slice 6 Execution", "EXEC"),
        (FOREIGN_PROJECT, "Slice 6 Foreign", "FRGN"),
    ] {
        project::ActiveModel {
            id: Set(id.to_owned()),
            name: Set(name.to_owned()),
            slug: Set(slug.to_owned()),
            description: Set(String::new()),
            seq_counter: Set(1000),
            state_revision: Set(0),
            created_at: Set(now),
            updated_at: Set(now),
            onboarding_required: Set(false),
        }
        .insert(&transaction)
        .await
        .expect("insert campaign project");
    }

    for (id, project_id, name, group, sort_order) in [
        (TODO, CAMPAIGN_PROJECT, "Todo", "unstarted", 1),
        (IMPLEMENT, CAMPAIGN_PROJECT, "Implement", "started", 2),
        (REVIEW, CAMPAIGN_PROJECT, "Review", "started", 3),
        (DONE, CAMPAIGN_PROJECT, "Done", "completed", 4),
        (FOREIGN_TODO, FOREIGN_PROJECT, "Todo", "unstarted", 1),
    ] {
        state::ActiveModel {
            id: Set(id.to_owned()),
            project_id: Set(project_id.to_owned()),
            name: Set(name.to_owned()),
            group: Set(group.to_owned()),
            color: Set("#4589FF".to_owned()),
            sort_order: Set(sort_order),
            is_protected: Set(false),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&transaction)
        .await
        .expect("insert campaign state");
    }

    for (id, project_id, name, level, sort_order, start_state_id) in [
        (MODULE_TYPE, CAMPAIGN_PROJECT, "Module", "module", 1, None),
        (
            TASK_TYPE,
            CAMPAIGN_PROJECT,
            "Implementation",
            "task",
            2,
            Some(TODO),
        ),
        (
            FOREIGN_MODULE_TYPE,
            FOREIGN_PROJECT,
            "Module",
            "module",
            1,
            None,
        ),
        (
            FOREIGN_TASK_TYPE,
            FOREIGN_PROJECT,
            "Implementation",
            "task",
            2,
            Some(FOREIGN_TODO),
        ),
    ] {
        issue_type::ActiveModel {
            id: Set(id.to_owned()),
            project_id: Set(project_id.to_owned()),
            name: Set(name.to_owned()),
            level: Set(level.to_owned()),
            color: Set(String::new()),
            sort_order: Set(sort_order),
            start_state_id: Set(start_state_id.map(str::to_owned)),
            workflow_revision: Set(1),
            is_pathfind: Set(false),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&transaction)
        .await
        .expect("insert campaign issue type");
    }

    for (issue_type_id, state_id, auto_start) in [
        (TASK_TYPE, TODO, false),
        (TASK_TYPE, IMPLEMENT, true),
        (FOREIGN_TASK_TYPE, FOREIGN_TODO, false),
    ] {
        launch_binding::ActiveModel {
            id: NotSet,
            issue_type_id: Set(issue_type_id.to_owned()),
            state_id: Set(state_id.to_owned()),
            prompt: Set("Implement the slice.".to_owned()),
            required_skills: Set(serde_json::json!([])),
            model_id: Set(Some(model.id.clone())),
            reasoning_id: Set(None),
            auto_start: Set(auto_start),
            subtree_run_enabled: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&transaction)
        .await
        .expect("insert campaign launch binding");
    }

    for (from_state_id, to_state_id) in [
        (TODO, IMPLEMENT),
        (TODO, REVIEW),
        (TODO, DONE),
        (IMPLEMENT, REVIEW),
        (IMPLEMENT, DONE),
        (REVIEW, DONE),
        (REVIEW, IMPLEMENT),
        (DONE, TODO),
    ] {
        issue_type_transition::ActiveModel {
            id: NotSet,
            issue_type_id: Set(TASK_TYPE.to_owned()),
            from_state_id: Set(from_state_id.to_owned()),
            to_state_id: Set(to_state_id.to_owned()),
            agent_allowed: Set(true),
        }
        .insert(&transaction)
        .await
        .expect("insert campaign transition");
    }

    insert_issue(
        &transaction,
        CAMPAIGN_MODULE,
        CAMPAIGN_PROJECT,
        MODULE_TYPE,
        "module",
        "Slice 6 module",
        900,
        "a",
        None,
        None,
        None,
        false,
        now,
    )
    .await;
    for fixture in [
        IssueFixture::task(
            PARALLEL_CAMPAIGN_ROOT,
            "Parallel root",
            901,
            "b",
            CAMPAIGN_MODULE,
        ),
        IssueFixture::task(READY_FIRST, "Ready first", 902, "a", PARALLEL_CAMPAIGN_ROOT),
        IssueFixture::task(
            READY_SECOND,
            "Ready second",
            903,
            "b",
            PARALLEL_CAMPAIGN_ROOT,
        ),
        IssueFixture::task(
            EXTERNALLY_BLOCKED,
            "Externally blocked",
            904,
            "c",
            PARALLEL_CAMPAIGN_ROOT,
        ),
        IssueFixture {
            archived: true,
            ..IssueFixture::task(
                ARCHIVED_CHILD,
                "Archived branch",
                905,
                "d",
                PARALLEL_CAMPAIGN_ROOT,
            )
        },
        IssueFixture::task(GRANDCHILD, "Grandchild", 906, "a", READY_FIRST),
        IssueFixture::task(
            SERIAL_CAMPAIGN_ROOT,
            "Serial root",
            910,
            "c",
            CAMPAIGN_MODULE,
        ),
        IssueFixture::task(SERIAL_FIRST, "Serial first", 911, "a", SERIAL_CAMPAIGN_ROOT),
        IssueFixture::task(
            SERIAL_SECOND,
            "Serial second",
            912,
            "b",
            SERIAL_CAMPAIGN_ROOT,
        ),
        IssueFixture::task(
            "00000000000000000000000000090343",
            "Serial third",
            913,
            "c",
            SERIAL_CAMPAIGN_ROOT,
        ),
        IssueFixture::task(
            OUTSIDE_BLOCKER,
            "Outside blocker",
            920,
            "d",
            CAMPAIGN_MODULE,
        ),
        IssueFixture::task(CHILDLESS_ROOT, "Childless root", 930, "e", CAMPAIGN_MODULE),
    ] {
        insert_task(
            &transaction,
            fixture,
            CAMPAIGN_PROJECT,
            CAMPAIGN_MODULE,
            TASK_TYPE,
            TODO,
            now,
        )
        .await;
    }

    insert_issue(
        &transaction,
        FOREIGN_MODULE,
        FOREIGN_PROJECT,
        FOREIGN_MODULE_TYPE,
        "module",
        "Foreign module",
        940,
        "a",
        None,
        None,
        None,
        false,
        now,
    )
    .await;
    for fixture in [
        IssueFixture::task(FOREIGN_ROOT, "Foreign root", 941, "b", FOREIGN_MODULE),
        IssueFixture::task(
            "00000000000000000000000000090431",
            "Foreign child",
            942,
            "a",
            FOREIGN_ROOT,
        ),
    ] {
        insert_task(
            &transaction,
            fixture,
            FOREIGN_PROJECT,
            FOREIGN_MODULE,
            FOREIGN_TASK_TYPE,
            FOREIGN_TODO,
            now,
        )
        .await;
    }

    for (blocked, blocker) in [
        (EXTERNALLY_BLOCKED, OUTSIDE_BLOCKER),
        (PARALLEL_CAMPAIGN_ROOT, OUTSIDE_BLOCKER),
    ] {
        issue_blocker::ActiveModel {
            id: NotSet,
            from_issue_id: Set(blocked.to_owned()),
            to_issue_id: Set(blocker.to_owned()),
        }
        .insert(&transaction)
        .await
        .expect("insert campaign blocker");
    }

    transaction.commit().await.expect("commit campaign fixture");
}

struct IssueFixture {
    id: &'static str,
    name: &'static str,
    sequence: i32,
    rank: &'static str,
    parent: &'static str,
    archived: bool,
}

impl IssueFixture {
    const fn task(
        id: &'static str,
        name: &'static str,
        sequence: i32,
        rank: &'static str,
        parent: &'static str,
    ) -> Self {
        Self {
            id,
            name,
            sequence,
            rank,
            parent,
            archived: false,
        }
    }
}

async fn insert_task(
    database: &sea_orm::DatabaseTransaction,
    fixture: IssueFixture,
    project_id: &str,
    module_id: &str,
    issue_type_id: &str,
    state_id: &str,
    now: chrono::NaiveDateTime,
) {
    insert_issue(
        database,
        fixture.id,
        project_id,
        issue_type_id,
        "task",
        fixture.name,
        fixture.sequence,
        fixture.rank,
        Some(fixture.parent),
        Some(module_id),
        Some(state_id),
        fixture.archived,
        now,
    )
    .await;
}

#[allow(clippy::too_many_arguments)]
async fn insert_issue(
    database: &sea_orm::DatabaseTransaction,
    id: &str,
    project_id: &str,
    issue_type_id: &str,
    kind: &str,
    name: &str,
    sequence_id: i32,
    rank: &str,
    parent_id: Option<&str>,
    module_id: Option<&str>,
    state_id: Option<&str>,
    is_archived: bool,
    now: chrono::NaiveDateTime,
) {
    issue::ActiveModel {
        id: Set(id.to_owned()),
        project_id: Set(project_id.to_owned()),
        r#type: Set(kind.to_owned()),
        issue_type_id: Set(issue_type_id.to_owned()),
        parent_id: Set(parent_id.map(str::to_owned)),
        module_id: Set(module_id.map(str::to_owned)),
        state_id: Set(state_id.map(str::to_owned)),
        state_revision: Set(0),
        name: Set(name.to_owned()),
        sequence_id: Set(sequence_id),
        is_archived: Set(is_archived),
        rank: Set(rank.to_owned()),
        description: Set(String::new()),
        workspace_tab_order: Set(serde_json::json!([])),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(database)
    .await
    .expect("insert campaign work item");
}
