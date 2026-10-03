use sea_orm::{
    sea_query::OnConflict, ConnectionTrait, DatabaseTransaction, DbErr, EntityTrait, Set,
};
use std::collections::BTreeSet;
use ticketry_entities::app_settings;

const POLICY_SCOPE: &str = "agent_run_mcp";
const ALLOWED: &[&str] = &[
    "mcp_ping",
    "terminate_current_run",
    "provider_lifecycle",
    "list_projects",
    "list_modules",
    "list_issue_types",
    "list_tasks",
    "get_task_details",
    "get_task_scope_context",
    "get_dependency_graph",
    "get_issue_type_workflow_settings",
    "get_sprint_goals",
    "suggest_sprint_story",
];

pub async fn restrict_sprint_suggestion_run_in(
    transaction: &DatabaseTransaction,
    run_id: &str,
) -> Result<(), DbErr> {
    app_settings::Entity::insert(app_settings::ActiveModel {
        scope: Set(POLICY_SCOPE.into()),
        key: Set(run_id.into()),
        value: Set(
            serde_json::to_string(ALLOWED).map_err(|error| DbErr::Custom(error.to_string()))?
        ),
        updated_at: Set(chrono::Utc::now().to_rfc3339()),
    })
    .on_conflict(
        OnConflict::columns([app_settings::Column::Scope, app_settings::Column::Key])
            .update_column(app_settings::Column::Value)
            .to_owned(),
    )
    .exec_without_returning(transaction)
    .await?;
    Ok(())
}

pub(super) async fn allowed_operations<C: ConnectionTrait>(
    database: &C,
    run_id: &str,
    grant: BTreeSet<String>,
) -> Result<BTreeSet<String>, DbErr> {
    let policy = app_settings::Entity::find_by_id((POLICY_SCOPE.to_owned(), run_id.to_owned()))
        .one(database)
        .await?;
    match policy {
        None => Ok(grant),
        Some(policy) => {
            let allowed: BTreeSet<String> = serde_json::from_str(&policy.value)
                .map_err(|error| DbErr::Custom(error.to_string()))?;
            Ok(grant.intersection(&allowed).cloned().collect())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{Database, DbBackend, Schema, TransactionTrait};

    async fn database() -> sea_orm::DatabaseConnection {
        let database = Database::connect("sqlite::memory:").await.unwrap();
        let table = Schema::new(DbBackend::Sqlite).create_table_from_entity(app_settings::Entity);
        database
            .execute_raw(DbBackend::Sqlite.build(&table))
            .await
            .unwrap();
        database
    }

    fn grant() -> BTreeSet<String> {
        [
            "update_task",
            "get_sprint_goals",
            "suggest_sprint_story",
            "terminate_current_run",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect()
    }

    #[tokio::test]
    async fn restrictions_survive_new_grants_and_repeated_binding() {
        let database = database().await;
        let txn = database.begin().await.unwrap();
        restrict_sprint_suggestion_run_in(&txn, "opaque-run")
            .await
            .unwrap();
        restrict_sprint_suggestion_run_in(&txn, "opaque-run")
            .await
            .unwrap();
        txn.commit().await.unwrap();
        for _ in 0..2 {
            let allowed = allowed_operations(&database, "opaque-run", grant())
                .await
                .unwrap();
            assert!(!allowed.contains("update_task"));
            assert!(allowed.contains("get_sprint_goals"));
            assert!(allowed.contains("suggest_sprint_story"));
            assert!(allowed.contains("terminate_current_run"));
        }
        assert_eq!(
            allowed_operations(&database, "normal-run", grant())
                .await
                .unwrap(),
            grant()
        );
    }

    #[tokio::test]
    async fn failed_sprint_binding_does_not_restrict_the_run() {
        let database = database().await;
        let txn = database.begin().await.unwrap();
        restrict_sprint_suggestion_run_in(&txn, "opaque-run")
            .await
            .unwrap();
        txn.rollback().await.unwrap();
        assert_eq!(
            allowed_operations(&database, "opaque-run", grant())
                .await
                .unwrap(),
            grant()
        );
    }
}
