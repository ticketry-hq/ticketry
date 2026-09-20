use sea_orm::{
    sea_query::{Expr, Index, OnConflict},
    ColumnTrait, Condition, ConnectionTrait, DatabaseConnection, EntityTrait, NotSet, QueryFilter,
    QueryOrder, QuerySelect, QueryTrait, Schema, Set,
};

use super::{types::DECISION_VERSION, LaunchPolicyDecision, LaunchPolicyError};
use ticketry_entities::{launch_policy_decision, transition_occurrence};

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
                .add(launch_policy_decision::Column::CallerScope.ne("run_now"))
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
    let mut payload: serde_json::Value =
        serde_json::from_str(&row.decision_json).map_err(invalid_decision)?;
    let payload_version = payload
        .get("version")
        .and_then(serde_json::Value::as_i64)
        .and_then(|version| i32::try_from(version).ok())
        .ok_or_else(|| invalid_decision("the payload version is missing or invalid"))?;
    if row.version != payload_version {
        return Err(invalid_decision(format!(
            "the row version {} does not match payload version {payload_version}",
            row.version
        )));
    }

    match payload_version {
        1 => {}
        2 => adapt_entry_skill(&mut payload)?,
        DECISION_VERSION => {}
        version => {
            return Err(invalid_decision(format!(
                "decision version {version} is not supported"
            )));
        }
    }

    serde_json::from_value(payload).map_err(invalid_decision)
}

fn adapt_entry_skill(payload: &mut serde_json::Value) -> Result<(), LaunchPolicyError> {
    let object = payload
        .as_object_mut()
        .ok_or_else(|| invalid_decision("the payload is not a JSON object"))?;
    if object.contains_key("stage_skills") {
        return Err(invalid_decision(
            "a version 2 payload unexpectedly contains stage_skills",
        ));
    }
    let stage_skills = match object.remove("entry_skill") {
        None | Some(serde_json::Value::Null) => Vec::new(),
        Some(serde_json::Value::String(skill)) => {
            let skill = skill.trim();
            if skill.is_empty() {
                Vec::new()
            } else {
                vec![serde_json::Value::String(skill.to_owned())]
            }
        }
        Some(_) => {
            return Err(invalid_decision(
                "a version 2 entry_skill must be a string or null",
            ));
        }
    };
    object.insert(
        "stage_skills".to_owned(),
        serde_json::Value::Array(stage_skills),
    );
    Ok(())
}

fn invalid_decision(error: impl std::fmt::Display) -> LaunchPolicyError {
    LaunchPolicyError::rejected(
        "launch_policy_decision_invalid",
        format!("Stored launch policy decision is invalid: {error}"),
    )
}
