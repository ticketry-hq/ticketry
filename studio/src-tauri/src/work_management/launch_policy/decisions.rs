use sea_orm::{
    sea_query::{Expr, Index, OnConflict},
    ColumnTrait, Condition, ConnectionTrait, DatabaseConnection, EntityTrait, NotSet, QueryFilter,
    QueryOrder, QuerySelect, QueryTrait, Schema, Set,
};

use super::{CallerScope, LaunchPolicyDecision, LaunchPolicyError};
use crate::work_management::entities::{launch_policy_decision, transition_occurrence};

pub(super) async fn ensure_schema(database: &impl ConnectionTrait) -> Result<(), sea_orm::DbErr> {
    let backend = database.get_database_backend();
    let schema = Schema::new(backend);
    let mut decision_table = schema.create_table_from_entity(launch_policy_decision::Entity);
    decision_table.if_not_exists();
    database.execute(&decision_table).await?;
    let index = Index::create()
        .name("idx_launch_policy_pending")
        .table(launch_policy_decision::Entity)
        .col(launch_policy_decision::Column::DeliveredAt)
        .col(launch_policy_decision::Column::CreatedAt)
        .col(launch_policy_decision::Column::DecisionId)
        .if_not_exists()
        .to_owned();
    database.execute(&index).await?;
    Ok(())
}

pub async fn record(
    database: &DatabaseConnection,
    decision: &LaunchPolicyDecision,
) -> Result<LaunchPolicyDecision, LaunchPolicyError> {
    let encoded = serde_json::to_string(decision).map_err(|error| {
        LaunchPolicyError::rejected(
            "launch_policy_serialization_failed",
            format!("Launch policy decision could not be serialized: {error}"),
        )
    })?;
    launch_policy_decision::Entity::insert(launch_policy_decision::ActiveModel {
        decision_id: Set(decision.decision_id.clone()),
        version: Set(decision.version),
        caller_scope: Set(decision.caller_scope.as_str().to_owned()),
        idempotency_key: Set(decision.idempotency_key.clone()),
        decision_json: Set(encoded),
        created_at: NotSet,
        delivered_at: NotSet,
    })
    .on_conflict(OnConflict::new().do_nothing().to_owned())
    .exec_without_returning(database)
    .await?;
    load_by_identity(
        database,
        decision.caller_scope.as_str(),
        &decision.idempotency_key,
    )
    .await?
    .ok_or_else(|| {
        LaunchPolicyError::rejected(
            "launch_policy_storage_failed",
            "The durable launch decision was not found after insertion.",
        )
    })
}

pub async fn mark_delivered(
    database: &DatabaseConnection,
    decision_id: &str,
) -> Result<(), LaunchPolicyError> {
    launch_policy_decision::Entity::update_many()
        .col_expr(
            launch_policy_decision::Column::DeliveredAt,
            Expr::current_timestamp(),
        )
        .filter(launch_policy_decision::Column::DecisionId.eq(decision_id))
        .exec(database)
        .await?;
    Ok(())
}

pub async fn pending(
    database: &DatabaseConnection,
    limit: u64,
) -> Result<Vec<LaunchPolicyDecision>, LaunchPolicyError> {
    let rows = launch_policy_decision::Entity::find()
        .filter(launch_policy_decision::Column::DeliveredAt.is_null())
        .filter(
            Condition::any()
                .add(
                    Condition::all()
                        .add(
                            launch_policy_decision::Column::CallerScope
                                .ne(CallerScope::RunNow.as_str()),
                        )
                        .add(
                            launch_policy_decision::Column::CallerScope
                                .ne(CallerScope::Interactive.as_str()),
                        ),
                )
                .add(
                    launch_policy_decision::Column::DecisionId.in_subquery(
                        transition_occurrence::Entity::find()
                            .select_only()
                            .column(transition_occurrence::Column::RunNowDecisionId)
                            .filter(transition_occurrence::Column::RunNowDecisionId.is_not_null())
                            .into_query(),
                    ),
                ),
        )
        .order_by_asc(launch_policy_decision::Column::CreatedAt)
        .order_by_asc(launch_policy_decision::Column::DecisionId)
        .limit(limit)
        .all(database)
        .await?;
    rows.into_iter().map(decode).collect()
}

pub async fn load_by_identity(
    database: &DatabaseConnection,
    caller_scope: &str,
    idempotency_key: &str,
) -> Result<Option<LaunchPolicyDecision>, LaunchPolicyError> {
    let row = launch_policy_decision::Entity::find()
        .filter(launch_policy_decision::Column::CallerScope.eq(caller_scope))
        .filter(launch_policy_decision::Column::IdempotencyKey.eq(idempotency_key))
        .one(database)
        .await?;
    row.map(decode).transpose()
}

fn decode(row: launch_policy_decision::Model) -> Result<LaunchPolicyDecision, LaunchPolicyError> {
    serde_json::from_str(&row.decision_json).map_err(|error| {
        LaunchPolicyError::rejected(
            "launch_policy_decision_invalid",
            format!("Stored launch policy decision is invalid: {error}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, Schema};

    use super::super::types::DECISION_VERSION;
    use super::*;
    use crate::work_management::launch_policy::ModuleLinkInput;

    fn decision(scope: CallerScope, identity: &str) -> LaunchPolicyDecision {
        LaunchPolicyDecision {
            version: DECISION_VERSION,
            decision_id: format!("decision-{identity}"),
            policy_identity: "binding:test".to_owned(),
            policy_version: 1,
            caller_scope: scope,
            idempotency_key: format!("request-{identity}"),
            task_id: "task".to_owned(),
            project_id: "project".to_owned(),
            issue_type_id: "story".to_owned(),
            state_id: "ideas".to_owned(),
            state_name: Some("Ideas".to_owned()),
            prompt: "Choose a route.".to_owned(),
            required_skills: Vec::new(),
            provider: "codex".to_owned(),
            model: None,
            reasoning: None,
            module_link: ModuleLinkInput {
                module_id: "module".to_owned(),
                path: Some("/tmp/module".to_owned()),
            },
        }
    }

    #[tokio::test]
    async fn pending_reconciliation_does_not_replay_a_refused_interactive_launch() {
        let database = Database::connect("sqlite::memory:")
            .await
            .expect("in-memory database");
        ensure_schema(&database).await.expect("decision schema");
        let schema = Schema::new(database.get_database_backend());
        database
            .execute(
                schema
                    .create_table_from_entity(transition_occurrence::Entity)
                    .if_not_exists(),
            )
            .await
            .expect("transition occurrence schema");

        record(
            &database,
            &decision(CallerScope::Interactive, "interactive"),
        )
        .await
        .expect("interactive decision");
        record(&database, &decision(CallerScope::AutoStart, "automatic"))
            .await
            .expect("automatic decision");

        let pending = pending(&database, 10).await.expect("pending decisions");

        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].caller_scope, CallerScope::AutoStart);
    }
}
