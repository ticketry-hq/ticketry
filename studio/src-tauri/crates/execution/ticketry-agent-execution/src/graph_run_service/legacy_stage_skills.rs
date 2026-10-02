//! Stage skills for Graph Run policy snapshots written before `stage_skills`
//! existed. Those launches took their entry skill from the launch binding at
//! terminal start, and migration 0059 moved that skill into the binding's
//! `stage_skills`, so the binding named by `policy_identity` is the source.

use sea_orm::{DatabaseConnection, DbErr, EntityTrait};
use ticketry_entities::launch_binding;

pub(super) async fn recover(
    database: &DatabaseConnection,
    policy_identity: &str,
) -> Result<Vec<String>, DbErr> {
    let Some(binding_id) = policy_identity
        .strip_prefix("launch-binding:")
        .and_then(|id| id.parse::<i64>().ok())
    else {
        return Ok(Vec::new());
    };
    let Some(binding) = launch_binding::Entity::find_by_id(binding_id)
        .one(database)
        .await?
    else {
        return Ok(Vec::new());
    };
    Ok(decode(binding.stage_skills))
}

fn decode(value: serde_json::Value) -> Vec<String> {
    let value = match value {
        serde_json::Value::String(encoded) => {
            serde_json::from_str(&encoded).unwrap_or(serde_json::Value::Null)
        }
        value => value,
    };
    serde_json::from_value(value).unwrap_or_default()
}
