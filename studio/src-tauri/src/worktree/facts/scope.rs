//! Which project and which owner a worktree fact belongs to.
//!
//! A settlement holds a Work Item identity — the one Studio asked about, or
//! the one recorded on the index row it is about to remove. Neither says which
//! project the change belongs to, and neither can be trusted to already be the
//! owner: a child Work Item shares its top-level parent's checkout, so a fact
//! published under the child would never reach the surfaces watching the
//! owner.
//!
//! Both answers are therefore derived here from the Work Item graph, through
//! the same ownership resolution every other worktree capability uses. An
//! identity that resolves to no active Work Item yields no scope, and the
//! caller publishes nothing rather than a fact aimed at a guessed project.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::worktree::status::identity::{canonical_uuid, compact_uuid};
use crate::worktree::status::owner;
use ticketry_entities::work_management::issue;

/// The authoritative addressing of one worktree fact.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorktreeFactScope {
    /// The owning top-level Work Item in public form — what the fact names and
    /// what a consumer keys its holding by.
    pub top_level_task_id: String,
    /// The same identity in row form — what the outbox column stores.
    pub top_level_row_id: String,
    /// The compact project identity the outbox partitions by.
    pub project_id: String,
}

/// Resolve the project and top-level owner for a worktree change.
///
/// `task_id` may be any Work Item that participates in the checkout — the
/// owner itself or a descendant sharing it — in either spelling. `None` means
/// the graph could not answer, which is a reason to publish nothing.
pub async fn resolve(work_items: &DatabaseConnection, task_id: &str) -> Option<WorktreeFactScope> {
    let owner = owner::resolve(work_items, task_id).await.ok()?;
    let top_level_row_id = owner.top_level_row_id();
    // The project comes off the owning row rather than off the worktree row's
    // own copy of it, so a stale or repointed index row cannot redirect a fact.
    let top_level = issue::Entity::find_by_id(top_level_row_id.clone())
        .filter(issue::Column::IsArchived.eq(false))
        .one(work_items)
        .await
        .ok()??;
    Some(WorktreeFactScope {
        top_level_task_id: canonical_uuid(&top_level.id),
        top_level_row_id,
        project_id: compact_uuid(&top_level.project_id),
    })
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    const PROJECT: &str = "10000000000000000000000000000000";
    const OTHER_PROJECT: &str = "10000000000000000000000000000009";
    const MODULE: &str = "20000000000000000000000000000001";
    const PARENT: &str = "60000000000000000000000000000001";
    const CHILD: &str = "60000000000000000000000000000002";
    const GRANDCHILD: &str = "60000000000000000000000000000003";
    const ARCHIVED: &str = "60000000000000000000000000000004";

    /// A Work Item graph whose module sits in a *different* project than the
    /// tasks, so a scope that read the wrong row would be visible.
    async fn graph() -> DatabaseConnection {
        let database = Database::connect("sqlite::memory:").await.expect("open");
        database
            .execute_unprepared(&format!(
                r#"
                CREATE TABLE worktracker_issue (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
                    issue_type_id TEXT NOT NULL, parent_id TEXT, module_id TEXT,
                    state_id TEXT, state_revision INTEGER NOT NULL DEFAULT 0,
                    name TEXT NOT NULL, sequence_id INTEGER NOT NULL,
                    is_archived BOOLEAN NOT NULL DEFAULT 0, rank TEXT NOT NULL DEFAULT 'm',
                    description TEXT NOT NULL DEFAULT '',
                    workspace_tab_order JSON NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL DEFAULT '2026-01-01 00:00:00',
                    updated_at TEXT NOT NULL DEFAULT '2026-01-01 00:00:00'
                );
                INSERT INTO worktracker_issue (id, project_id, type, issue_type_id, parent_id, module_id, name, sequence_id, is_archived)
                VALUES
                  ('{MODULE}','{OTHER_PROJECT}','module','t',NULL,NULL,'Module',1,0),
                  ('{PARENT}','{PROJECT}','task','t',NULL,'{MODULE}','Parent',2,0),
                  ('{CHILD}','{PROJECT}','task','t','{PARENT}','{MODULE}','Child',3,0),
                  ('{GRANDCHILD}','{PROJECT}','task','t','{CHILD}','{MODULE}','Grandchild',4,0),
                  ('{ARCHIVED}','{PROJECT}','task','t',NULL,'{MODULE}','Archived',5,1);
                "#
            ))
            .await
            .expect("seed the Work Item graph");
        database
    }

    #[tokio::test]
    async fn a_descendant_is_scoped_to_the_owner_that_holds_the_checkout() {
        let database = graph().await;
        let owner = resolve(&database, PARENT).await.expect("resolve the owner");

        for descendant in [CHILD, GRANDCHILD] {
            assert_eq!(
                resolve(&database, descendant).await,
                Some(owner.clone()),
                "a shared checkout publishes under its top-level owner"
            );
        }
    }

    #[tokio::test]
    async fn the_project_is_read_from_the_owning_work_item() {
        let database = graph().await;
        let scope = resolve(&database, CHILD).await.expect("resolve");

        assert_eq!(scope.project_id, PROJECT, "not the module's project");
        assert_eq!(
            scope.top_level_task_id, "60000000-0000-0000-0000-000000000001",
            "the owner is published in the form a consumer keys by"
        );
        assert_eq!(scope.top_level_row_id, PARENT);
    }

    #[tokio::test]
    async fn an_identity_the_graph_cannot_answer_for_publishes_nothing() {
        let database = graph().await;

        // A module is a container and never an owner; an archived or unknown
        // Work Item has no active owner at all.
        assert_eq!(resolve(&database, MODULE).await, None);
        assert_eq!(resolve(&database, ARCHIVED).await, None);
        assert_eq!(
            resolve(&database, "60000000000000000000000000009999").await,
            None
        );
    }
}
